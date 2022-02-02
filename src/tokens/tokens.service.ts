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

import { URLSearchParams } from 'url';
import { HttpService } from '@nestjs/axios';
import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AxiosRequestConfig } from 'axios';
import { lastValueFrom } from 'rxjs';
import ERC20WithDataABI from '../../solidity/build/contracts/ERC20WithData.json';
import ERC721WithDataABI from '../../solidity/build/contracts/ERC721WithData.json';
import {
  Event,
  EventStream,
  EventStreamReply,
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
  EthConnectMsgRequest,
  EthConnectReturn,
  IAbiMethod,
  ITokenPool,
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
} from './tokens.interfaces';
import { decodeHex, encodeHex, packSubscriptionName, unpackSubscriptionName } from './tokens.util';

export const standardAbiMap = {
  ERC20WithData: ERC20WithDataABI.abi,
  ERC721WithData: ERC721WithDataABI.abi,
};

const standardMethodMap = {
  ERC20WithData: {
    MINT: 'mintWithData',
    TRANSFER: 'transferWithData',
    BURN: 'burnWithData',
    TRANSFEREVENT: 'Transfer',
  },
  ERC721WithData: {
    MINT: 'mintWithData',
    TRANSFER: 'transferWithData',
    BURN: 'burnWithData',
    TRANSFEREVENT: 'Transfer',
  },
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const sendTransactionHeader = 'SendTransaction';
const transferEvent = 'Transfer';
const transferEventSignature = 'Transfer(address,address,uint256)';

type ContractStandardStrings = keyof typeof ContractStandardEnum;

@Injectable()
export class TokensService {
  baseUrl: string;
  topic: string;
  shortPrefix: string;
  stream: EventStream;
  username: string;
  password: string;

  constructor(
    public http: HttpService,
    private eventstream: EventStreamService,
    private proxy: EventStreamProxyGateway,
  ) {}

  configure(
    baseUrl: string,
    topic: string,
    shortPrefix: string,
    username: string,
    password: string,
  ) {
    this.baseUrl = baseUrl;
    this.topic = topic;
    this.shortPrefix = shortPrefix;
    this.username = username;
    this.password = password;
    this.proxy.addListener(new TokenListener(this));
  }

  private getMethodAbi(
    poolId: URLSearchParams,
    operation: 'MINT' | 'TRANSFER' | 'BURN' | 'TRANSFEREVENT',
  ): IAbiMethod | undefined {
    const standard = poolId.get(EncodedPoolIdEnum.Standard) as ContractStandardStrings;
    const standardAbi: IAbiMethod[] = standardAbiMap[standard];
    const method = standardAbi?.find(abi => abi.name === standardMethodMap[standard][operation]);
    return method;
  }

  private getAmountOrTokenID(
    dto: TokenMint | TokenTransfer | TokenBurn,
    type: TokenType,
  ): string | undefined {
    if (type === TokenType.FUNGIBLE) {
      return dto.amount;
    }

    if (dto.amount !== undefined && dto.amount !== '1') {
      throw new HttpException('Amount for nonfungible tokens must be 1', HttpStatus.BAD_REQUEST);
    }

    return dto.tokenIndex;
  }

  private validatePoolId(poolId: URLSearchParams): ITokenPool {
    if (
      poolId.get(EncodedPoolIdEnum.Address) === null ||
      poolId.get(EncodedPoolIdEnum.Standard) === null ||
      poolId.get(EncodedPoolIdEnum.Type) === null
    ) {
      throw new HttpException('Invalid Pool ID', HttpStatus.BAD_REQUEST);
    }

    return {
      address: poolId.get(EncodedPoolIdEnum.Address),
      standard: poolId.get(EncodedPoolIdEnum.Standard),
      type: poolId.get(EncodedPoolIdEnum.Type),
    } as ITokenPool;
  }

  /**
   * One-time initialization of event stream and base subscription.
   */
  init() {
    return;
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

  createPool(dto: TokenPool): TokenPoolEvent {
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
    const validPoolId: ITokenPool = this.validatePoolId(new URLSearchParams(dto.poolId));
    if (this.stream === undefined) {
      this.stream = await this.eventstream.createOrUpdateStream(this.topic);
    }
    const encodedPoolId = new URLSearchParams(dto.poolId);
    const methodAbi = this.getMethodAbi(encodedPoolId, 'TRANSFEREVENT');

    if (!methodAbi) {
      throw new HttpException('ABI event not found', HttpStatus.NOT_FOUND);
    }

    const possibleMethods: string[] = Object.values(standardMethodMap[validPoolId.standard]);
    const standardABI: IAbiMethod[] = standardAbiMap[validPoolId.standard];
    const methodsToSubTo: IAbiMethod[] = standardABI.filter((method: IAbiMethod) =>
      possibleMethods.includes(method.name ?? ''),
    );

    await this.eventstream.getOrCreateSubscription(
      `${this.baseUrl}`,
      methodAbi,
      this.stream.id,
      transferEvent,
      packSubscriptionName(this.topic, dto.poolId, transferEvent),
      validPoolId.address,
      methodsToSubTo,
      dto.transaction?.blockNumber ?? '0',
    );

    const tokenPoolEvent: TokenPoolEvent = {
      poolId: dto.poolId,
      standard: validPoolId.standard,
      timestamp: Date.now().toString(),
      type: validPoolId.type,
    };

    return tokenPoolEvent;
  }

  async mint(dto: TokenMint): Promise<AsyncResponse> {
    const validPoolId: ITokenPool = this.validatePoolId(new URLSearchParams(dto.poolId));
    const encodedPoolId = new URLSearchParams(dto.poolId);
    const methodAbi = this.getMethodAbi(encodedPoolId, 'MINT');
    const response = await lastValueFrom(
      this.http.post<EthConnectAsyncResponse>(
        `${this.baseUrl}`,
        {
          headers: {
            type: sendTransactionHeader,
          },
          from: dto.operator,
          to: validPoolId.address,
          method: methodAbi,
          params: [
            dto.to,
            this.getAmountOrTokenID(dto, validPoolId.type),
            encodeHex(dto.data ?? ''),
          ],
        } as EthConnectMsgRequest,
        this.postOptions(dto.operator, dto.requestId),
      ),
    );

    return { id: response.data.id };
  }

  async transfer(dto: TokenTransfer): Promise<AsyncResponse> {
    const validPoolId: ITokenPool = this.validatePoolId(new URLSearchParams(dto.poolId));
    const methodAbi = this.getMethodAbi(new URLSearchParams(dto.poolId), 'TRANSFER');
    const response = await lastValueFrom(
      this.http.post<EthConnectAsyncResponse>(
        `${this.baseUrl}`,
        {
          headers: {
            type: sendTransactionHeader,
          },
          from: dto.operator,
          to: validPoolId.address,
          method: methodAbi,
          params: [
            dto.from,
            dto.to,
            this.getAmountOrTokenID(dto, validPoolId.type),
            encodeHex(dto.data ?? ''),
          ],
        } as EthConnectMsgRequest,
        this.postOptions(dto.operator, dto.requestId),
      ),
    );
    return { id: response.data.id };
  }

  async burn(dto: TokenBurn): Promise<AsyncResponse> {
    const validPoolId: ITokenPool = this.validatePoolId(new URLSearchParams(dto.poolId));
    const methodAbi = this.getMethodAbi(new URLSearchParams(dto.poolId), 'BURN');
    const response = await lastValueFrom(
      this.http.post<EthConnectAsyncResponse>(
        `${this.baseUrl}`,
        {
          headers: {
            type: sendTransactionHeader,
          },
          from: dto.operator,
          to: validPoolId.address,
          method: methodAbi,
          params: [
            dto.from,
            this.getAmountOrTokenID(dto, validPoolId.type),
            encodeHex(dto.data ?? ''),
          ],
        } as EthConnectMsgRequest,
        this.postOptions(dto.operator, dto.requestId),
      ),
    );
    return { id: response.data.id };
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
}

class TokenListener implements EventListener {
  private readonly logger = new Logger(TokenListener.name);

  constructor(private readonly service: TokensService) {}

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

  private async getTokenUri(
    tokenIdx: string,
    operator: string,
    contractAddress: string,
  ): Promise<string> {
    const methodABI = standardAbiMap.ERC721WithData.find(method => method.name === 'tokenURI');

    const response = await lastValueFrom(
      this.service.http.post<EthConnectReturn>(
        `${this.service.baseUrl}?`,
        {
          from: operator,
          to: contractAddress,
          method: methodABI,
          params: [tokenIdx],
        } as EthConnectMsgRequest,
        this.postOptions(operator, true),
      ),
    );

    return response.data.output;
  }

  private async transformTransferEvent(
    subName: string,
    event: TransferEvent,
    eventIndex?: number,
  ): Promise<WebSocketMessage | undefined> {
    const { data } = event;
    const unpackedSub = unpackSubscriptionName(this.service.topic, subName);
    const decodedData = decodeHex(event.inputArgs?.data ?? '');

    if (data.from === ZERO_ADDRESS && data.to === ZERO_ADDRESS) {
      // should not happen
      return undefined;
    }

    // This intentionally matches the formatting of protocol IDs for blockchain events in FireFly core
    const blockNumber = event.blockNumber ?? '0';
    const txIndex = BigInt(event.transactionIndex).toString(10);
    const logIndex = event.logIndex ?? '0';
    let transferId = [
      blockNumber.padStart(12, '0'),
      txIndex.padStart(6, '0'),
      logIndex.padStart(6, '0'),
    ].join('/');
    if (eventIndex !== undefined) {
      transferId += '/' + eventIndex.toString(10).padStart(6, '0');
    }

    const validPool = new URLSearchParams(unpackedSub.poolId);
    const address = validPool.get(EncodedPoolIdEnum.Address);
    const poolType = validPool.get(EncodedPoolIdEnum.Type);

    const commonData = {
      id: transferId,
      type: poolType,
      poolId: unpackedSub.poolId,
      amount: poolType === TokenType.FUNGIBLE ? data.value : '1',
      operator: event.inputSigner,
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
    } as TokenTransferEvent;

    if (poolType === TokenType.NONFUNGIBLE && data.tokenId !== undefined) {
      commonData.tokenIndex = data.tokenId;
      commonData.uri = await this.getTokenUri(data.tokenId, event.inputSigner ?? '', address ?? '');
    }

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
  private postOptions(operator: string, callValue: boolean) {
    const from = `${this.service.shortPrefix}-from`;
    const sync = `${this.service.shortPrefix}-sync`;
    const call = `${this.service.shortPrefix}-call`;

    const requestOptions: AxiosRequestConfig = {
      params: {
        [from]: operator,
        [sync]: 'false',
        [call]: callValue ? 'true' : 'false',
      },
      ...basicAuth(this.service.username, this.service.password),
    };

    return requestOptions;
  }
}
