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
import ERC20NoDataABI from '../abi/ERC20NoData.json';
import ERC20WithDataABI from '../abi/ERC20WithData.json';
import ERC721NoDataABI from '../abi/ERC721NoData.json';
import ERC721WithDataABI from '../abi/ERC721WithData.json';
import {
  Event,
  EventStream,
  EventStreamReply,
  EventStreamSubscription,
} from '../event-stream/event-stream.interfaces';
import { EventStreamService } from '../event-stream/event-stream.service';
import { EventStreamProxyGateway } from '../eventstream-proxy/eventstream-proxy.gateway';
import { EventListener, EventProcessor } from '../eventstream-proxy/eventstream-proxy.interfaces';
import { basicAuth } from '../utils';
import { WebSocketMessage } from '../websocket-events/websocket-events.base';
import {
  ApprovalEvent,
  ApprovalForAllEvent,
  AsyncResponse,
  BlockchainTransaction,
  ContractSchema,
  EthConnectAsyncResponse,
  EthConnectMsgRequest,
  EthConnectReturn,
  IAbiMethod,
  ITokenPool,
  IValidTokenPool,
  TokenApproval,
  TokenApprovalConfig,
  TokenApprovalEvent,
  TokenBurn,
  TokenBurnEvent,
  TokenMint,
  TokenMintEvent,
  TokenPool,
  TokenPoolActivate,
  TokenPoolConfig,
  TokenPoolEvent,
  TokenTransfer,
  TokenTransferEvent,
  TokenType,
  TransferEvent,
} from './tokens.interfaces';
import {
  decodeHex,
  encodeHex,
  packPoolId,
  packSubscriptionName,
  unpackPoolId,
  unpackSubscriptionName,
} from './tokens.util';

export const abiSchemaMap = new Map<ContractSchemaStrings, IAbiMethod[]>();
abiSchemaMap.set('ERC20NoData', ERC20NoDataABI.abi);
abiSchemaMap.set('ERC20WithData', ERC20WithDataABI.abi);
abiSchemaMap.set('ERC721NoData', ERC721NoDataABI.abi);
abiSchemaMap.set('ERC721WithData', ERC721WithDataABI.abi);

export interface AbiMethods {
  MINT: string;
  TRANSFER: string;
  BURN: string;
  NAME: string;
  SYMBOL: string;
  APPROVE: string;
  APPROVEFORALL: string | null;
}

export interface AbiEvents {
  TRANSFER: string;
  APPROVAL: string;
  APPROVALFORALL: string | null;
}

const abiMethodMap = new Map<ContractSchemaStrings, AbiMethods>();
abiMethodMap.set('ERC20NoData', {
  MINT: 'mint',
  TRANSFER: 'transferFrom',
  BURN: 'burn',
  APPROVE: 'approve',
  APPROVEFORALL: null,
  NAME: 'name',
  SYMBOL: 'symbol',
});
abiMethodMap.set('ERC20WithData', {
  MINT: 'mintWithData',
  TRANSFER: 'transferWithData',
  BURN: 'burnWithData',
  APPROVE: 'approveWithData',
  APPROVEFORALL: null,
  NAME: 'name',
  SYMBOL: 'symbol',
});
abiMethodMap.set('ERC721WithData', {
  MINT: 'mintWithData',
  TRANSFER: 'transferWithData',
  BURN: 'burnWithData',
  APPROVE: 'approveWithData',
  APPROVEFORALL: 'setApprovalForAllWithData',
  NAME: 'name',
  SYMBOL: 'symbol',
});
abiMethodMap.set('ERC721NoData', {
  MINT: 'mint',
  TRANSFER: 'safeTransferFrom',
  BURN: 'burn',
  APPROVE: 'approve',
  APPROVEFORALL: 'setApprovalForAll',
  NAME: 'name',
  SYMBOL: 'symbol',
});

const abiEventMap = new Map<ContractSchemaStrings, AbiEvents>();
abiEventMap.set('ERC20NoData', {
  TRANSFER: 'Transfer',
  APPROVAL: 'Approval',
  APPROVALFORALL: null,
});
abiEventMap.set('ERC20WithData', {
  TRANSFER: 'Transfer',
  APPROVAL: 'Approval',
  APPROVALFORALL: null,
});
abiEventMap.set('ERC721NoData', {
  TRANSFER: 'Transfer',
  APPROVAL: 'Approval',
  APPROVALFORALL: 'ApprovalForAll',
});
abiEventMap.set('ERC721WithData', {
  TRANSFER: 'Transfer',
  APPROVAL: 'Approval',
  APPROVALFORALL: 'ApprovalForAll',
});

const UINT256_MAX = BigInt(2) ** BigInt(256) - BigInt(1);
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const sendTransactionHeader = 'SendTransaction';
const queryHeader = 'Query';
const transferEventSignature = 'Transfer(address,address,uint256)';
const approvalEventSignature = 'Approval(address,address,uint256)';
const approvalForAllEventSignature = 'ApprovalForAll(address,address,bool)';

type ContractSchemaStrings = keyof typeof ContractSchema;

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

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
    schema: ContractSchemaStrings,
    operation: keyof AbiMethods,
  ): IAbiMethod | undefined {
    const contractAbi = abiSchemaMap.get(schema);
    const abiMethods = abiMethodMap.get(schema);
    if (contractAbi === undefined || abiMethods === undefined) {
      return undefined;
    }
    return contractAbi.find(abi => abi.name === abiMethods[operation]);
  }

  private getEventAbi(
    schema: ContractSchemaStrings,
    operation: keyof AbiEvents,
  ): IAbiMethod | undefined {
    const contractAbi = abiSchemaMap.get(schema);
    const abiEvents = abiEventMap.get(schema);
    if (contractAbi === undefined || abiEvents === undefined) {
      return undefined;
    }
    return contractAbi.find(abi => abi.name === abiEvents[operation]);
  }

  private getTokenSchema(type: TokenType, withData = true): string {
    if (type === TokenType.FUNGIBLE) {
      return withData ? 'ERC20WithData' : 'ERC20NoData';
    }
    return withData ? 'ERC721WithData' : 'ERC721NoData';
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
    return poolId.address !== null && poolId.schema !== null && poolId.type !== null;
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

  /**
   * If there is an existing event stream whose subscriptions don't match the current
   * events and naming format, delete the stream so we'll start over.
   * This will cause redelivery of all token events, which will poke FireFly to
   * (re)activate pools and (re)process all transfers.
   *
   * TODO: eventually this migration logic can be pruned
   */
  async migrate() {
    const streams = await this.eventstream.getStreams();
    const existingStream = streams.find(s => s.name === this.topic);
    if (existingStream === undefined) {
      return;
    }
    const subscriptions = await this.eventstream.getSubscriptions();
    if (subscriptions.length === 0) {
      return;
    }

    const mappedSubs: Record<string, EventStreamSubscription[]> = {};
    for (const sub of subscriptions.filter(s => s.stream === existingStream.id)) {
      const parts = unpackSubscriptionName(this.topic, sub.name);
      if (parts.poolId !== undefined) {
        if (mappedSubs[parts.poolId] === undefined) {
          mappedSubs[parts.poolId] = [];
        }
        mappedSubs[parts.poolId].push(sub);
      } else {
        this.logger.warn(`Unable to parse subscription ${sub.name} - deleting`);
        await this.eventstream.deleteSubscription(sub.id);
      }
    }

    for (const poolId in mappedSubs) {
      const foundEvents = new Set<string>();
      for (const sub of mappedSubs[poolId]) {
        const parts = unpackSubscriptionName(this.topic, sub.name);
        if (parts.event !== undefined && parts.event !== '') {
          foundEvents.add(parts.event);
        }
      }

      const unpackedPoolId = unpackPoolId(poolId);
      if (this.validatePoolId(unpackedPoolId)) {
        const abiEvents = abiEventMap.get(unpackedPoolId.schema as ContractSchemaStrings);
        if (abiEvents !== undefined) {
          // Expect to have found subscriptions for each of the events
          const allEvents = [abiEvents.TRANSFER, abiEvents.APPROVAL, abiEvents.APPROVALFORALL];
          if (allEvents.every(e => e === null || foundEvents.has(e))) {
            continue;
          }
        }
      }

      this.logger.warn(
        `Incorrect event stream subscriptions found for ${poolId} - deleting and recreating`,
      );
      for (const sub of mappedSubs[poolId]) {
        await this.eventstream.deleteSubscription(sub.id);
      }
      await this.activatePool({ poolId });
    }
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

  private async queryPool(poolId: IValidTokenPool) {
    const schema = poolId.schema as ContractSchemaStrings;
    const nameResponse = await lastValueFrom(
      this.http.post<EthConnectReturn>(
        `${this.baseUrl}`,
        {
          headers: {
            type: queryHeader,
          },
          to: poolId.address,
          method: this.getMethodAbi(schema, 'NAME'),
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
          method: this.getMethodAbi(schema, 'SYMBOL'),
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
    const schema = this.getTokenSchema(dto.type, dto.config.withData);
    const poolId: ITokenPool = {
      address: dto.config.address,
      type: dto.type,
      schema,
    };
    if (!this.validatePoolId(poolId)) {
      throw new BadRequestException('Invalid poolId');
    }
    const encodedPoolId = packPoolId(poolId);

    const nameAndSymbol = await this.queryPool(poolId);
    if (dto.symbol !== undefined && dto.symbol !== '' && dto.symbol !== nameAndSymbol.symbol) {
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

  getSubscriptionBlockNumber(poolConfig?: TokenPoolConfig, transaction?: BlockchainTransaction): string {
    let blockNumber = '0';
    if (poolConfig?.blockNumber) {
      blockNumber = String(poolConfig.blockNumber)
    } else if (transaction?.blockNumber) {
      blockNumber = transaction.blockNumber;
    }
    return blockNumber;
  }

  async activatePool(dto: TokenPoolActivate) {
    const poolId = unpackPoolId(dto.poolId);
    if (!this.validatePoolId(poolId)) {
      throw new BadRequestException('Invalid poolId');
    }

    const schema = poolId.schema as ContractSchemaStrings;
    const stream = await this.getStream();
    const transferAbi = this.getEventAbi(schema, 'TRANSFER');
    if (!transferAbi) {
      throw new NotFoundException('Transfer event ABI not found');
    }
    const approvalAbi = this.getEventAbi(schema, 'APPROVAL');
    if (!approvalAbi) {
      throw new NotFoundException('Approval event ABI not found');
    }

    const abiMethods = abiMethodMap.get(poolId.schema as ContractSchemaStrings);
    const abiEvents = abiEventMap.get(poolId.schema as ContractSchemaStrings);
    const contractAbi = abiSchemaMap.get(schema);
    if (abiMethods === undefined || abiEvents === undefined || contractAbi === undefined) {
      throw new BadRequestException(`Unknown schema: ${poolId.schema}`);
    }

    const possibleMethods: string[] = Object.values(abiMethods);
    const methodsToSubTo: IAbiMethod[] = contractAbi.filter(
      method => method.name !== undefined && possibleMethods.includes(method.name),
    );

    const promises = [
      this.eventstream.getOrCreateSubscription(
        `${this.baseUrl}`,
        transferAbi,
        stream.id,
        abiEvents.TRANSFER,
        packSubscriptionName(this.topic, dto.poolId, abiEvents.TRANSFER),
        poolId.address,
        methodsToSubTo,
        this.getSubscriptionBlockNumber(dto.poolConfig, dto.transaction),
      ),
      this.eventstream.getOrCreateSubscription(
        `${this.baseUrl}`,
        approvalAbi,
        stream.id,
        abiEvents.APPROVAL,
        packSubscriptionName(this.topic, dto.poolId, abiEvents.APPROVAL),
        poolId.address,
        methodsToSubTo,
        this.getSubscriptionBlockNumber(dto.poolConfig, dto.transaction),
      ),
    ];
    if (abiEvents.APPROVALFORALL !== null) {
      const approvalForAllAbi = this.getEventAbi(schema, 'APPROVALFORALL');
      if (!approvalForAllAbi) {
        throw new NotFoundException('ApprovalForAll event ABI not found');
      }
      promises.push(
        this.eventstream.getOrCreateSubscription(
          `${this.baseUrl}`,
          approvalForAllAbi,
          stream.id,
          abiEvents.APPROVALFORALL,
          packSubscriptionName(this.topic, dto.poolId, abiEvents.APPROVALFORALL),
          poolId.address,
          methodsToSubTo,
          this.getSubscriptionBlockNumber(dto.poolConfig, dto.transaction),
        ),
      );
    }
    await Promise.all(promises);

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
      throw new BadRequestException('Invalid poolId');
    }

    const schema = poolId.schema as ContractSchemaStrings;
    const methodAbi = this.getMethodAbi(schema, 'MINT');
    const params = [dto.to, this.getAmountOrTokenID(dto, poolId.type)];
    poolId.schema.includes('WithData') && params.push(encodeHex(dto.data ?? ''));

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
          params,
        } as EthConnectMsgRequest,
        this.postOptions(dto.signer, dto.requestId),
      ),
    );

    return { id: response.data.id };
  }

  async transfer(dto: TokenTransfer): Promise<AsyncResponse> {
    const poolId = unpackPoolId(dto.poolId);
    if (!this.validatePoolId(poolId)) {
      throw new BadRequestException('Invalid poolId');
    }

    const schema = poolId.schema as ContractSchemaStrings;
    const methodAbi = this.getMethodAbi(schema, 'TRANSFER');
    const params = [dto.from, dto.to, this.getAmountOrTokenID(dto, poolId.type)];
    poolId.schema.includes('WithData') && params.push(encodeHex(dto.data ?? ''));

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
          params,
        } as EthConnectMsgRequest,
        this.postOptions(dto.signer, dto.requestId),
      ),
    );
    return { id: response.data.id };
  }

  async burn(dto: TokenBurn): Promise<AsyncResponse> {
    const poolId = unpackPoolId(dto.poolId);
    if (!this.validatePoolId(poolId)) {
      throw new BadRequestException('Invalid poolId');
    }

    const schema = poolId.schema as ContractSchemaStrings;
    const methodAbi = this.getMethodAbi(schema, 'BURN');
    const params = [dto.from, this.getAmountOrTokenID(dto, poolId.type)];
    poolId.schema.includes('WithData') && params.push(encodeHex(dto.data ?? ''));

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
          params,
        } as EthConnectMsgRequest,
        this.postOptions(dto.signer, dto.requestId),
      ),
    );
    return { id: response.data.id };
  }

  async approval(dto: TokenApproval): Promise<AsyncResponse> {
    const poolId = unpackPoolId(dto.poolId);
    if (!this.validatePoolId(poolId)) {
      throw new BadRequestException('Invalid poolId');
    }

    let methodAbi: IAbiMethod | undefined;
    const params: any[] = [];
    const schema = poolId.schema as ContractSchemaStrings;

    switch (poolId.type) {
      case TokenType.FUNGIBLE:
        // Not approved means 0 allowance; approved with no allowance means unlimited allowance
        const allowance = !dto.approved ? '0' : dto.config?.allowance ?? UINT256_MAX.toString();
        params.push(dto.operator, allowance);
        methodAbi = this.getMethodAbi(schema, 'APPROVE');
        break;
      case TokenType.NONFUNGIBLE:
        if (dto.config?.tokenIndex !== undefined) {
          // Not approved means setting approved operator to 0
          const operator = !dto.approved ? ZERO_ADDRESS : dto.operator;
          params.push(operator, dto.config.tokenIndex);
          methodAbi = this.getMethodAbi(schema, 'APPROVE');
        } else {
          params.push(dto.operator, dto.approved);
          methodAbi = this.getMethodAbi(schema, 'APPROVEFORALL');
        }
        break;
    }

    poolId.schema.includes('WithData') && params.push(encodeHex(dto.data ?? ''));
    const response = await lastValueFrom(
      this.http.post<EthConnectAsyncResponse>(`${this.baseUrl}`, {
        headers: {
          type: sendTransactionHeader,
        },
        from: dto.signer,
        to: poolId.address,
        method: methodAbi,
        params,
      } as EthConnectMsgRequest),
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
      case transferEventSignature:
        process(await this.transformTransferEvent(subName, event));
        break;
      case approvalEventSignature:
        process(this.transformApprovalEvent(subName, event));
        break;
      case approvalForAllEventSignature:
        process(this.transformApprovalForAllEvent(subName, event));
        break;
      default:
        this.logger.error(`Unknown event signature: ${event.signature}`);
    }
  }

  private async getTokenUri(
    tokenIdx: string,
    signer: string,
    contractAddress: string,
  ): Promise<string> {
    const abiMethods = abiSchemaMap.get('ERC721WithData');
    if (abiMethods === undefined) {
      // should not happen
      return '';
    }

    const methodABI = abiMethods.find(method => method.name === 'tokenURI');
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

  private transformApprovalEvent(
    subName: string,
    event: ApprovalEvent,
  ): WebSocketMessage | undefined {
    const { data } = event;
    const unpackedSub = unpackSubscriptionName(this.service.topic, subName);
    const decodedData = decodeHex(event.inputArgs?.data ?? '');

    if (unpackedSub.poolId === undefined) {
      // should not happen
      return undefined;
    }
    const poolId = unpackPoolId(unpackedSub.poolId);

    let id: string | undefined;
    let approved = true;
    if (poolId.type === TokenType.FUNGIBLE) {
      id = `${data.owner}:${data.spender}`;
      approved = BigInt(data.value ?? 0) > BigInt(0);
    } else {
      id = data.tokenId;
      approved = data.spender !== ZERO_ADDRESS;
    }

    return {
      event: 'token-approval',
      data: <TokenApprovalEvent>{
        id,
        location: 'address=' + event.address,
        signature: event.signature,
        type: poolId.type,
        poolId: unpackedSub.poolId,
        operator: data.spender,
        approved,
        signer: data.owner,
        data: decodedData,
        timestamp: event.timestamp,
        rawOutput: data,
        transaction: {
          blockNumber: event.blockNumber,
          transactionIndex: event.transactionIndex,
          transactionHash: event.transactionHash,
          logIndex: event.logIndex,
          address: event.address,
          signature: event.signature,
        },
      },
    };
  }

  private transformApprovalForAllEvent(
    subName: string,
    event: ApprovalForAllEvent,
  ): WebSocketMessage | undefined {
    const { data } = event;
    const unpackedSub = unpackSubscriptionName(this.service.topic, subName);
    const decodedData = decodeHex(event.inputArgs?.data ?? '');

    if (unpackedSub.poolId === undefined) {
      // should not happen
      return undefined;
    }
    const poolId = unpackPoolId(unpackedSub.poolId);

    return {
      event: 'token-approval',
      data: <TokenApprovalEvent>{
        id: `${data.owner}:${data.operator}`,
        location: 'address=' + event.address,
        signature: event.signature,
        type: poolId.type,
        poolId: unpackedSub.poolId,
        operator: data.operator,
        approved: data.approved,
        signer: data.owner,
        data: decodedData,
        timestamp: event.timestamp,
        rawOutput: data,
        transaction: {
          blockNumber: event.blockNumber,
          transactionIndex: event.transactionIndex,
          transactionHash: event.transactionHash,
          logIndex: event.logIndex,
          address: event.address,
          signature: event.signature,
        },
      },
    };
  }
}
