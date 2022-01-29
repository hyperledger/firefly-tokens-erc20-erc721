// Copyright © 2022 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { HttpService } from '@nestjs/axios';
import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AxiosRequestConfig } from 'axios';
import { lastValueFrom } from 'rxjs';
import { ERC20WithDataABI } from '../contractStandards/ERC20WithData';
import {
  Event,
  EventStream,
  EventStreamReply,
  TokenCreateEvent,
  TransferEvent,
} from '../event-stream/event-stream.interfaces';
import { EventStreamService } from '../event-stream/event-stream.service';
import { EventStreamProxyGateway } from '../eventstream-proxy/eventstream-proxy.gateway';
import { EventListener, EventProcessor } from '../eventstream-proxy/eventstream-proxy.interfaces';
import { basicAuth } from '../utils';
import { WebSocketMessage } from '../websocket-events/websocket-events.base';
import {
  AsyncResponse,
  ContractStandardEnum,
  EncodedPoolIdEnum,
  EthConnectAsyncResponse,
  EthConnectContractsResponse,
  EthConnectMsgRequest,
  IAbiMethod,
  TokenBalance,
  TokenBalanceQuery,
  TokenBurn,
  TokenBurnEvent,
  TokenMint,
  TokenMintEvent,
  TokenPool,
  TokenPoolActivate,
  TokenPoolEvent,
  TokenTransfer,
  TokenTransferEvent,
  TokenType,
  TransactionDetails,
} from './tokens.interfaces';
import { decodeHex, packSubscriptionName, unpackSubscriptionName } from './tokens.util';

const standardAbiMap = {
  ERC20WithData: ERC20WithDataABI,
};

const standardMethodMap = {
  ERC20WithData: {
    CREATE: 'create',
    MINT: 'mintWithData',
    TRANSFER: 'transferWithData',
    BURN: 'burnWithData',
    BALANCE: 'balanceOf',
  },
};

const TOKEN_STANDARD = 'ERC20';
const BASE_SUBSCRIPTION_NAME = 'base';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const transferEvent = 'Transfer';
const transferEventSignature = 'Transfer(address,address,uint256)';

type ContractStandardStrings = keyof typeof ContractStandardEnum;

@Injectable()
export class TokensService {
  baseUrl: string;
  instancePath: string;
  instanceUrl: string;
  topic: string;
  shortPrefix: string;
  contractUri: string;
  contractInstanceUrl: string;
  stream: EventStream;
  username: string;
  password: string;

  constructor(
    private http: HttpService,
    private eventstream: EventStreamService,
    private proxy: EventStreamProxyGateway,
  ) {}

  configure(
    baseUrl: string,
    instancePath: string,
    topic: string,
    shortPrefix: string,
    contractUri: string,
    username: string,
    password: string,
  ) {
    this.baseUrl = baseUrl;
    this.instancePath = instancePath;
    this.instanceUrl = `${this.baseUrl}${this.instancePath}`;
    this.topic = topic;
    this.shortPrefix = shortPrefix;
    this.contractUri = contractUri;
    this.contractInstanceUrl = `${this.baseUrl}${this.contractUri}`;
    this.username = username;
    this.password = password;
    this.proxy.addListener(new TokenListener(this, this.topic));
  }

  private getMethodAbi(
    poolId: URLSearchParams,
    operation: 'MINT' | 'TRANSFER' | 'BURN' | 'BALANCE',
  ): IAbiMethod | undefined {
    const standard = poolId.get('contractStandard') as ContractStandardStrings;
    const standardAbi: IAbiMethod[] = standardAbiMap[standard];
    const method = standardAbi.find(abi => abi.name === standardMethodMap[standard][operation]);
    return method;
  }

  /**
   * One-time initialization of event stream and base subscription.
   */
  async init() {
    // this.stream = await this.eventstream.createOrUpdateStream(this.topic);
    // await this.eventstream.getOrCreateSubscription(
    //   this.instanceUrl,
    //   this.stream.id,
    //   tokenCreateEvent,
    //   packSubscriptionName(this.topic, BASE_SUBSCRIPTION_NAME),
    // );
  }

  private postOptions(operator: string, requestId?: string) {
    const from = `${this.shortPrefix}-from`;
    const sync = `${this.shortPrefix}-sync`;
    const id = `${this.shortPrefix}-id`;

    const requestOptions: AxiosRequestConfig = {
      params: {
        [from]: operator,
        [sync]: 'false',
        [id]: requestId,
      },
      ...basicAuth(this.username, this.password),
    };

    return requestOptions;
  }

  async createPool(dto: TokenPool): Promise<TokenPoolEvent> {
    if (!Object.values(TokenType).includes(dto.type)) {
      throw new HttpException('Address Not Found', HttpStatus.NOT_FOUND);
    }

    const response = await lastValueFrom(
      this.http.get<EthConnectContractsResponse>(`${this.baseUrl}/contracts/${dto.config.address}`),
    );
    if (response.status === 404) {
      throw new HttpException('Address Not Found', HttpStatus.NOT_FOUND);
    }

    const poolId = new URLSearchParams({
      address: dto.config.address,
      standard: dto.type === TokenType.FUNGIBLE ? 'ERC20WithData' : 'ERC721WithData',
      type: dto.type,
    });

    const tokenPoolEvent: TokenPoolEvent = {
      data: dto.data,
      poolId: poolId.toString(),
      standard: poolId.get(EncodedPoolIdEnum.Standard)?.toString() ?? '',
      timestamp: Date.now().toString(),
      type: dto.type,
    };

    return tokenPoolEvent;
  }

  async activatePool(dto: TokenPoolActivate) {
    if (this.stream === undefined) {
      this.stream = await this.eventstream.createOrUpdateStream(this.topic);
    }
    await this.eventstream.getOrCreateSubscription(
      `${this.baseUrl}/${dto.poolId}`,
      this.stream.id,
      transferEvent,
      packSubscriptionName(this.topic, dto.poolId, transferEvent),
      dto.transaction?.blockNumber ?? '0',
    );

    const decodedPoolId = new URLSearchParams(dto.poolId);

    const tokenPoolEvent: TokenPoolEvent = {
      poolId: decodedPoolId.get(EncodedPoolIdEnum.Address)?.toString() ?? '',
      standard: decodedPoolId.get(EncodedPoolIdEnum.Standard)?.toString() ?? '',
      timestamp: Date.now().toString(),
      type: decodedPoolId.get(EncodedPoolIdEnum.Type)?.toString() ?? '',
    };

    return tokenPoolEvent;
  }

  async mint(dto: TokenMint): Promise<AsyncResponse> {
    const encodedPoolId = new URLSearchParams(dto.poolId);
    const methodAbi = this.getMethodAbi(encodedPoolId, 'MINT');
    const response = await lastValueFrom(
      this.http.post<EthConnectAsyncResponse>(
        `${this.baseUrl}`,
        {
          headers: {
            type: 'SendTransaction',
          },
          from: dto.operator,
          to: encodedPoolId.get(EncodedPoolIdEnum.Address),
          method: methodAbi,
          params: [dto.to, dto.amount, dto.data],
        } as EthConnectMsgRequest,
        this.postOptions(dto.operator, dto.requestId),
      ),
    );
    return { id: response.data.id };
  }

  async transfer(dto: TokenTransfer): Promise<AsyncResponse> {
    const encodedPoolId = new URLSearchParams(dto.poolId);
    const methodAbi = this.getMethodAbi(new URLSearchParams(dto.poolId), 'TRANSFER');
    const response = await lastValueFrom(
      this.http.post<EthConnectAsyncResponse>(
        `${this.baseUrl}`,
        {
          headers: {
            type: 'SendTransaction',
          },
          from: dto.operator,
          to: encodedPoolId.get(EncodedPoolIdEnum.Address),
          method: methodAbi,
          params: [dto.from, dto.to, dto.amount, dto.data],
        } as EthConnectMsgRequest,
        this.postOptions(dto.operator, dto.requestId),
      ),
    );
    return { id: response.data.id };
  }

  async burn(dto: TokenBurn): Promise<AsyncResponse> {
    const encodedPoolId = new URLSearchParams(dto.poolId);
    const methodAbi = this.getMethodAbi(new URLSearchParams(dto.poolId), 'BURN');
    const response = await lastValueFrom(
      this.http.post<EthConnectAsyncResponse>(
        `${this.baseUrl}`,
        {
          headers: {
            type: 'SendTransaction',
          },
          from: dto.operator,
          to: encodedPoolId.get(EncodedPoolIdEnum.Address),
          method: methodAbi,
          params: [dto.amount, dto.data],
        } as EthConnectMsgRequest,
        this.postOptions(dto.operator, dto.requestId),
      ),
    );
    return { id: response.data.id };
  }

  async balance(dto: TokenBalanceQuery): Promise<TokenBalance> {
    const encodedPoolId = new URLSearchParams(dto.poolId);
    const methodAbi = this.getMethodAbi(new URLSearchParams(dto.poolId), 'BALANCE');
    const response = await lastValueFrom(
      this.http.post<EthConnectAsyncResponse>(`${this.baseUrl}`, {
        headers: {
          type: 'SendTransaction',
        },
        to: encodedPoolId.get(EncodedPoolIdEnum.Address),
        method: methodAbi,
        params: [dto.account],
      } as EthConnectMsgRequest),
    );

    return { balance: '' };
  }

  async getReceipt(id: string): Promise<EventStreamReply> {
    const response = await lastValueFrom(
      this.http.get<EventStreamReply>(`${this.baseUrl}/reply/${id}`, {
        validateStatus: status => status < 300 || status === 404,
        ...basicAuth(this.username, this.password),
      }),
    );
    if (response.status === 404) {
      throw new NotFoundException();
    }
    return response.data;
  }

  public async getOperator(poolId: string, txId: string, inputMethod: string): Promise<string> {
    const response = await lastValueFrom(
      this.http.get<TransactionDetails>(
        `${this.contractInstanceUrl}/${poolId}/${inputMethod}?fly-transaction=${txId}&stream=${this.stream.id}`,
        {
          ...basicAuth(this.username, this.password),
        },
      ),
    );
    return response.data.from;
  }
}

class TokenListener implements EventListener {
  private readonly logger = new Logger(TokenListener.name);

  constructor(private readonly service: TokensService, private topic: string) {}

  async onEvent(subName: string, event: Event, process: EventProcessor) {
    switch (event.signature) {
      case transferEventSignature: {
        const transformedEvent = await this.transformTransferEvent(subName, event);
        process(transformedEvent);
        break;
      }
      default:
        this.logger.error(`Unknown event signature: ${event.signature}`);
        return undefined;
    }
  }

  private transformTokenCreateEvent(
    subName: string,
    event: TokenCreateEvent,
  ): WebSocketMessage | undefined {
    const { data } = event;
    const unpackedSub = unpackSubscriptionName(this.topic, subName);
    const decodedData = decodeHex(data.data ?? '');

    if (
      unpackedSub.poolId !== BASE_SUBSCRIPTION_NAME &&
      unpackedSub.poolId !== data.contract_address
    ) {
      return undefined;
    }

    return {
      event: 'token-pool',
      data: <TokenPoolEvent>{
        standard: TOKEN_STANDARD,
        poolId: event.data.contract_address,
        type: TokenType.FUNGIBLE,
        operator: data.operator,
        data: decodedData,
        timestamp: event.timestamp,
        rawOutput: data,
        transaction: {
          blockNumber: event.blockNumber,
          transactionIndex: event.transactionIndex,
          transactionHash: event.transactionHash,
          logIndex: event.logIndex,
          signature: event.signature,
        },
      },
    };
  }

  private async transformTransferEvent(
    subName: string,
    event: TransferEvent,
  ): Promise<WebSocketMessage | undefined> {
    const { data } = event;
    const unpackedSub = unpackSubscriptionName(this.topic, subName);
    const decodedData = decodeHex(event.inputArgs?.data ?? '');

    if (data.from === ZERO_ADDRESS && data.to === ZERO_ADDRESS) {
      // should not happen
      return undefined;
    }

    const txIndex = BigInt(event.transactionIndex).toString(10);
    const transferId = [event.blockNumber, txIndex, event.logIndex].join('.');
    // TODO: Have ethconnect fetch this
    const operator: string = await this.service.getOperator(
      event.address,
      event.transactionHash,
      event.inputMethod ?? '',
    );

    const commonData = <TokenTransferEvent>{
      id: transferId,
      type: TokenType.FUNGIBLE,
      poolId: unpackedSub.poolId,
      amount: data.value,
      operator,
      data: decodedData,
      timestamp: event.timestamp,
      rawOutput: data,
      transaction: {
        blockNumber: event.blockNumber,
        transactionIndex: event.transactionIndex,
        transactionHash: event.transactionHash,
        logIndex: event.logIndex,
        signature: event.signature,
      },
    };

    if (data.from === ZERO_ADDRESS) {
      return {
        event: 'token-mint',
        data: { ...commonData, to: data.to } as TokenMintEvent,
      };
    } else if (data.to === ZERO_ADDRESS) {
      return {
        event: 'token-burn',
        data: { ...commonData, from: data.from } as TokenBurnEvent,
      };
    } else {
      return {
        event: 'token-transfer',
        data: { ...commonData, from: data.from, to: data.to } as TokenTransferEvent,
      };
    }
  }
}
