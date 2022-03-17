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
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
  ContractSchema,
  EthConnectAsyncResponse,
  EthConnectMsgRequest,
  EthConnectReturn,
  IAbiMethod,
  ITokenPool,
  IValidTokenPool,
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
import {
  decodeHex,
  encodeHex,
  packPoolId,
  packSubscriptionName,
  unpackPoolId,
  unpackSubscriptionName,
} from './tokens.util';

export const abiTypeMap = {
  ERC20WithData: ERC20WithDataABI.abi,
  ERC721WithData: ERC721WithDataABI.abi,
};

const abiMethodMap = {
  ERC20WithData: {
    MINT: 'mintWithData',
    TRANSFER: 'transferWithData',
    BURN: 'burnWithData',
    TRANSFEREVENT: 'Transfer',
    NAME: 'name',
    SYMBOL: 'symbol',
  },
  ERC721WithData: {
    MINT: 'mintWithData',
    TRANSFER: 'transferWithData',
    BURN: 'burnWithData',
    TRANSFEREVENT: 'Transfer',
    NAME: 'name',
    SYMBOL: 'symbol',
  },
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const sendTransactionHeader = 'SendTransaction';
const queryHeader = 'Query';
const transferEvent = 'Transfer';
const transferEventSignature = 'Transfer(address,address,uint256)';

type ContractSchemaStrings = keyof typeof ContractSchema;

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
    poolId: ITokenPool,
    operation: 'MINT' | 'TRANSFER' | 'BURN' | 'TRANSFEREVENT' | 'NAME' | 'SYMBOL',
  ): IAbiMethod | undefined {
    const contractType = poolId.schema as ContractSchemaStrings;
    const contractAbi: IAbiMethod[] = abiTypeMap[contractType];
    const method = contractAbi?.find(abi => abi.name === abiMethodMap[contractType][operation]);
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
      throw new BadRequestException('Amount for nonfungible tokens must be 1');
    }

    return dto.tokenIndex;
  }

  private validatePoolId(poolId: ITokenPool): poolId is IValidTokenPool {
    return !(poolId.address === null || poolId.schema === null || poolId.type === null);
  }

  /**
   * One-time initialization of event stream and base subscription.
   */
  init() {
    return;
  }

  private async getStream() {
    if (this.stream === undefined) {
      this.stream = await this.eventstream.createOrUpdateStream(this.topic);
    }
    return this.stream;
  }

  private postOptions(signer: string, requestId?: string) {
    const from = `${this.shortPrefix}-from`;
    const sync = `${this.shortPrefix}-sync`;
    const id = `${this.shortPrefix}-id`;

    const requestOptions: AxiosRequestConfig = {
      params: {
        [from]: signer,
        [sync]: 'false',
        [id]: requestId,
      },
      ...basicAuth(this.username, this.password),
    };
    return requestOptions;
  }

  private queryOptions() {
    const requestOptions: AxiosRequestConfig = {
      ...basicAuth(this.username, this.password),
    };
    return requestOptions;
  }

  private async queryPool(poolId: ITokenPool) {
    this.validatePoolId(poolId);
    const nameResponse = await lastValueFrom(
      this.http.post<EthConnectReturn>(
        `${this.baseUrl}`,
        {
          headers: {
            type: queryHeader,
          },
          to: poolId.address,
          method: this.getMethodAbi(poolId, 'NAME'),
          params: [],
        } as EthConnectMsgRequest,
        this.queryOptions(),
      ),
    );
    const symbolResponse = await lastValueFrom(
      this.http.post<EthConnectReturn>(
        `${this.baseUrl}`,
        {
          headers: {
            type: queryHeader,
          },
          to: poolId.address,
          method: this.getMethodAbi(poolId, 'SYMBOL'),
          params: [],
        } as EthConnectMsgRequest,
        this.queryOptions(),
      ),
    );
    return {
      name: nameResponse.data.output,
      symbol: symbolResponse.data.output,
    };
  }

  async createPool(dto: TokenPool): Promise<TokenPoolEvent> {
    const schema = dto.type === TokenType.FUNGIBLE ? 'ERC20WithData' : 'ERC721WithData';
    const poolId: ITokenPool = {
      address: dto.config.address,
      schema: schema,
      type: dto.type,
    };
    if (!this.validatePoolId(poolId)) {
      throw new BadRequestException('Invalid Pool ID');
    }
    const encodedPoolId = packPoolId(poolId);

    const nameAndSymbol = await this.queryPool(poolId);
    if (nameAndSymbol.symbol !== dto.symbol) {
      throw new BadRequestException(
        `Supplied symbol '${dto.symbol}' does not match expected '${nameAndSymbol.symbol}'`,
      );
    }

    const tokenPoolEvent: TokenPoolEvent = {
      data: dto.data,
      poolId: encodedPoolId.toString(),
      standard: dto.type === TokenType.FUNGIBLE ? 'ERC20' : 'ERC721',
      timestamp: Date.now().toString(),
      type: dto.type,
      symbol: nameAndSymbol.symbol,
      info: {
        name: nameAndSymbol.name,
        address: dto.config.address,
        schema,
      },
    };

    return tokenPoolEvent;
  }

  async activatePool(dto: TokenPoolActivate) {
    const poolId = unpackPoolId(dto.poolId);
    if (!this.validatePoolId(poolId)) {
      throw new BadRequestException('Invalid Pool ID');
    }

    const stream = await this.getStream();
    const methodAbi = this.getMethodAbi(poolId, 'TRANSFEREVENT');
    if (!methodAbi) {
      throw new NotFoundException('ABI event not found');
    }

    const possibleMethods: string[] = Object.values(abiMethodMap[poolId.schema]);
    const contractAbi: IAbiMethod[] = abiTypeMap[poolId.schema];
    const methodsToSubTo: IAbiMethod[] = contractAbi.filter((method: IAbiMethod) =>
      possibleMethods.includes(method.name ?? ''),
    );

    await this.eventstream.getOrCreateSubscription(
      `${this.baseUrl}`,
      methodAbi,
      stream.id,
      transferEvent,
      packSubscriptionName(this.topic, dto.poolId, transferEvent),
      poolId.address,
      methodsToSubTo,
      dto.transaction?.blockNumber ?? '0',
    );

    const nameAndSymbol = await this.queryPool(poolId);

    const tokenPoolEvent: TokenPoolEvent = {
      poolId: dto.poolId,
      standard: poolId.type === TokenType.FUNGIBLE ? 'ERC20' : 'ERC721',
      timestamp: Date.now().toString(),
      type: poolId.type,
      symbol: nameAndSymbol.symbol,
      info: {
        name: nameAndSymbol.name,
        address: poolId.address,
        schema: poolId.schema,
      },
    };

    return tokenPoolEvent;
  }

  async mint(dto: TokenMint): Promise<AsyncResponse> {
    const poolId = unpackPoolId(dto.poolId);
    if (!this.validatePoolId(poolId)) {
      throw new BadRequestException('Invalid Pool ID');
    }

    const methodAbi = this.getMethodAbi(poolId, 'MINT');
    const response = await lastValueFrom(
      this.http.post<EthConnectAsyncResponse>(
        `${this.baseUrl}`,
        {
          headers: {
            type: sendTransactionHeader,
          },
          from: dto.signer,
          to: poolId.address,
          method: methodAbi,
          params: [dto.to, this.getAmountOrTokenID(dto, poolId.type), encodeHex(dto.data ?? '')],
        } as EthConnectMsgRequest,
        this.postOptions(dto.signer, dto.requestId),
      ),
    );

    return { id: response.data.id };
  }

  async transfer(dto: TokenTransfer): Promise<AsyncResponse> {
    const poolId = unpackPoolId(dto.poolId);
    if (!this.validatePoolId(poolId)) {
      throw new BadRequestException('Invalid Pool ID');
    }

    const methodAbi = this.getMethodAbi(poolId, 'TRANSFER');
    const response = await lastValueFrom(
      this.http.post<EthConnectAsyncResponse>(
        `${this.baseUrl}`,
        {
          headers: {
            type: sendTransactionHeader,
          },
          from: dto.signer,
          to: poolId.address,
          method: methodAbi,
          params: [
            dto.from,
            dto.to,
            this.getAmountOrTokenID(dto, poolId.type),
            encodeHex(dto.data ?? ''),
          ],
        } as EthConnectMsgRequest,
        this.postOptions(dto.signer, dto.requestId),
      ),
    );
    return { id: response.data.id };
  }

  async burn(dto: TokenBurn): Promise<AsyncResponse> {
    const poolId = unpackPoolId(dto.poolId);
    if (!this.validatePoolId(poolId)) {
      throw new BadRequestException('Invalid Pool ID');
    }

    const methodAbi = this.getMethodAbi(poolId, 'BURN');
    const response = await lastValueFrom(
      this.http.post<EthConnectAsyncResponse>(
        `${this.baseUrl}`,
        {
          headers: {
            type: sendTransactionHeader,
          },
          from: dto.signer,
          to: poolId.address,
          method: methodAbi,
          params: [dto.from, this.getAmountOrTokenID(dto, poolId.type), encodeHex(dto.data ?? '')],
        } as EthConnectMsgRequest,
        this.postOptions(dto.signer, dto.requestId),
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
    signer: string,
    contractAddress: string,
  ): Promise<string> {
    const methodABI = abiTypeMap.ERC721WithData.find(method => method.name === 'tokenURI');
    try {
      const response = await lastValueFrom(
        this.service.http.post<EthConnectReturn>(`${this.service.baseUrl}?`, {
          headers: {
            type: 'Query',
          },
          from: signer,
          to: contractAddress,
          method: methodABI,
          params: [tokenIdx],
        } as EthConnectMsgRequest),
      );
      return response.data.output;
    } catch (e) {
      this.logger.log(`Burned tokens do not have a URI: ${e}`);
      return '';
    }
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
    if (unpackedSub.poolId === undefined) {
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

    const poolId = unpackPoolId(unpackedSub.poolId);

    const commonData = {
      id: transferId,
      location: 'address=' + event.address,
      signature: event.signature,
      type: poolId.type,
      poolId: unpackedSub.poolId,
      amount: poolId.type === TokenType.FUNGIBLE ? data.value : '1',
      signer: event.inputSigner,
      data: decodedData,
      timestamp: event.timestamp,
      rawOutput: data,
      transaction: {
        address: event.address,
        blockNumber: event.blockNumber,
        transactionIndex: event.transactionIndex,
        transactionHash: event.transactionHash,
        logIndex: event.logIndex,
        signature: event.signature,
      },
    } as TokenTransferEvent;

    if (poolId.type === TokenType.NONFUNGIBLE && data.tokenId !== undefined) {
      commonData.tokenIndex = data.tokenId;
      commonData.uri = await this.getTokenUri(
        data.tokenId,
        event.inputSigner ?? '',
        poolId.address ?? '',
      );
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
}
