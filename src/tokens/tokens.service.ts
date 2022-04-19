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
import { Event, EventStream, EventStreamReply } from '../event-stream/event-stream.interfaces';
import { EventStreamService } from '../event-stream/event-stream.service';
import { EventStreamProxyGateway } from '../eventstream-proxy/eventstream-proxy.gateway';
import { EventListener, EventProcessor } from '../eventstream-proxy/eventstream-proxy.interfaces';
import { basicAuth } from '../utils';
import { WebSocketMessage } from '../websocket-events/websocket-events.base';
import {
  ApprovalEvent,
  ApprovalForAllEvent,
  AsyncResponse,
  ContractSchema,
  EthConnectAsyncResponse,
  EthConnectMsgRequest,
  EthConnectReturn,
  IAbiMethod,
  IPoolLocator,
  IValidPoolLocator,
  TokenApproval,
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
  packPoolLocator,
  packSubscriptionName,
  unpackPoolLocator,
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

  private validatePoolLocator(poolLocator: IPoolLocator): poolLocator is IValidPoolLocator {
    return poolLocator.address !== null && poolLocator.schema !== null && poolLocator.type !== null;
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
   * Check for existing event streams and subscriptions that don't match the current
   * expected format (ie incorrect names, missing event subscriptions).
   *
   * Log a warning if any potential issues are flagged. User may need to delete
   * subscriptions manually and reactivate the pool directly.
   */
  async migrationCheck(): Promise<boolean> {
    const streams = await this.eventstream.getStreams();
    const existingStream = streams.find(s => s.name === this.topic);
    if (existingStream === undefined) {
      return false;
    }

    const allSubscriptions = await this.eventstream.getSubscriptions();
    const streamId = existingStream.id;
    const subscriptions = allSubscriptions.filter(s => s.stream === streamId);
    if (subscriptions.length === 0) {
      return false;
    }

    const foundEvents = new Map<string, string[]>();
    for (const sub of subscriptions.filter(s => s.stream === existingStream.id)) {
      const parts = unpackSubscriptionName(this.topic, sub.name);
      if (parts.poolLocator === undefined || parts.event === undefined) {
        this.logger.warn(
          `Non-parseable subscription names found in event stream ${existingStream.name}.` +
            `It is recommended to delete all subscriptions and activate all pools again.`,
        );
        return true;
      }
      const existing = foundEvents.get(parts.poolLocator);
      if (existing !== undefined) {
        existing.push(parts.event);
      } else {
        foundEvents.set(parts.poolLocator, [parts.event]);
      }
    }

    // Expect to have found subscriptions for each of the events.
    for (const [poolLocator, events] of foundEvents) {
      const unpackedLocator = unpackPoolLocator(poolLocator);
      if (!this.validatePoolLocator(unpackedLocator)) {
        this.logger.warn(
          `Could not parse pool locator: ${poolLocator}. ` +
            `It is recommended to delete subscriptions for this pool and activate the pool again.`,
        );
        return true;
      }
      const abiEvents = abiEventMap.get(unpackedLocator.schema as ContractSchemaStrings);
      if (abiEvents === undefined) {
        this.logger.warn(
          `Could not parse schema from pool locator: ${poolLocator}. ` +
            `It is recommended to delete subscriptions for this pool and activate the pool again.`,
        );
        return true;
      }
      const allEvents = [abiEvents.TRANSFER, abiEvents.APPROVAL, abiEvents.APPROVALFORALL];
      if (
        allEvents.length !== events.length ||
        !allEvents.every(event => event == null || events.includes(event))
      ) {
        this.logger.warn(
          `Event stream subscriptions for pool ${poolLocator} do not include all expected events ` +
            `(${allEvents}). Events may not be properly delivered to this pool. ` +
            `It is recommended to delete its subscriptions and activate the pool again.`,
        );
        return true;
      }
    }
    return false;
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

  private async queryPool(poolLocator: IValidPoolLocator) {
    const schema = poolLocator.schema as ContractSchemaStrings;
    const nameResponse = await lastValueFrom(
      this.http.post<EthConnectReturn>(
        `${this.baseUrl}`,
        {
          headers: {
            type: queryHeader,
          },
          to: poolLocator.address,
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
          to: poolLocator.address,
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
    const poolLocator: IPoolLocator = {
      address: dto.config.address,
      type: dto.type,
      schema,
    };
    if (!this.validatePoolLocator(poolLocator)) {
      throw new BadRequestException('Invalid pool locator');
    }
    const nameAndSymbol = await this.queryPool(poolLocator);
    if (dto.symbol !== undefined && dto.symbol !== '' && dto.symbol !== nameAndSymbol.symbol) {
      throw new BadRequestException(
        `Supplied symbol '${dto.symbol}' does not match expected '${nameAndSymbol.symbol}'`,
      );
    }

    const tokenPoolEvent: TokenPoolEvent = {
      data: dto.data,
      poolLocator: packPoolLocator(poolLocator),
      standard: dto.type === TokenType.FUNGIBLE ? 'ERC20' : 'ERC721',
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

  getSubscriptionBlockNumber(config?: TokenPoolConfig): string {
    if (config?.blockNumber !== undefined && config.blockNumber !== '') {
      return config.blockNumber;
    } else {
      return '0';
    }
  }

  async activatePool(dto: TokenPoolActivate) {
    const poolLocator = unpackPoolLocator(dto.poolLocator);
    if (!this.validatePoolLocator(poolLocator)) {
      throw new BadRequestException('Invalid pool locator');
    }

    const schema = poolLocator.schema as ContractSchemaStrings;
    const stream = await this.getStream();
    const transferAbi = this.getEventAbi(schema, 'TRANSFER');
    if (!transferAbi) {
      throw new NotFoundException('Transfer event ABI not found');
    }
    const approvalAbi = this.getEventAbi(schema, 'APPROVAL');
    if (!approvalAbi) {
      throw new NotFoundException('Approval event ABI not found');
    }

    const abiMethods = abiMethodMap.get(poolLocator.schema as ContractSchemaStrings);
    const abiEvents = abiEventMap.get(poolLocator.schema as ContractSchemaStrings);
    const contractAbi = abiSchemaMap.get(schema);
    if (abiMethods === undefined || abiEvents === undefined || contractAbi === undefined) {
      throw new BadRequestException(`Unknown schema: ${poolLocator.schema}`);
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
        packSubscriptionName(this.topic, dto.poolLocator, abiEvents.TRANSFER),
        poolLocator.address,
        methodsToSubTo,
        this.getSubscriptionBlockNumber(dto.config),
      ),
      this.eventstream.getOrCreateSubscription(
        `${this.baseUrl}`,
        approvalAbi,
        stream.id,
        abiEvents.APPROVAL,
        packSubscriptionName(this.topic, dto.poolLocator, abiEvents.APPROVAL),
        poolLocator.address,
        methodsToSubTo,
        this.getSubscriptionBlockNumber(dto.config),
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
          packSubscriptionName(this.topic, dto.poolLocator, abiEvents.APPROVALFORALL),
          poolLocator.address,
          methodsToSubTo,
          this.getSubscriptionBlockNumber(dto.config),
        ),
      );
    }
    await Promise.all(promises);

    const nameAndSymbol = await this.queryPool(poolLocator);
    const tokenPoolEvent: TokenPoolEvent = {
      poolLocator: dto.poolLocator,
      standard: poolLocator.type === TokenType.FUNGIBLE ? 'ERC20' : 'ERC721',
      type: poolLocator.type,
      symbol: nameAndSymbol.symbol,
      info: {
        name: nameAndSymbol.name,
        address: poolLocator.address,
        schema: poolLocator.schema,
      },
    };

    return tokenPoolEvent;
  }

  async mint(dto: TokenMint): Promise<AsyncResponse> {
    const poolLocator = unpackPoolLocator(dto.poolLocator);
    if (!this.validatePoolLocator(poolLocator)) {
      throw new BadRequestException('Invalid pool locator');
    }

    const schema = poolLocator.schema as ContractSchemaStrings;
    const methodAbi = this.getMethodAbi(schema, 'MINT');
    const params = [dto.to, this.getAmountOrTokenID(dto, poolLocator.type)];
    poolLocator.schema.includes('WithData') && params.push(encodeHex(dto.data ?? ''));

    const response = await lastValueFrom(
      this.http.post<EthConnectAsyncResponse>(
        `${this.baseUrl}`,
        {
          headers: {
            type: sendTransactionHeader,
          },
          from: dto.signer,
          to: poolLocator.address,
          method: methodAbi,
          params,
        } as EthConnectMsgRequest,
        this.postOptions(dto.signer, dto.requestId),
      ),
    );

    return { id: response.data.id };
  }

  async transfer(dto: TokenTransfer): Promise<AsyncResponse> {
    const poolLocator = unpackPoolLocator(dto.poolLocator);
    if (!this.validatePoolLocator(poolLocator)) {
      throw new BadRequestException('Invalid pool locator');
    }

    const schema = poolLocator.schema as ContractSchemaStrings;
    const methodAbi = this.getMethodAbi(schema, 'TRANSFER');
    const params = [dto.from, dto.to, this.getAmountOrTokenID(dto, poolLocator.type)];
    poolLocator.schema.includes('WithData') && params.push(encodeHex(dto.data ?? ''));

    const response = await lastValueFrom(
      this.http.post<EthConnectAsyncResponse>(
        `${this.baseUrl}`,
        {
          headers: {
            type: sendTransactionHeader,
          },
          from: dto.signer,
          to: poolLocator.address,
          method: methodAbi,
          params,
        } as EthConnectMsgRequest,
        this.postOptions(dto.signer, dto.requestId),
      ),
    );
    return { id: response.data.id };
  }

  async burn(dto: TokenBurn): Promise<AsyncResponse> {
    const poolLocator = unpackPoolLocator(dto.poolLocator);
    if (!this.validatePoolLocator(poolLocator)) {
      throw new BadRequestException('Invalid pool locator');
    }

    const schema = poolLocator.schema as ContractSchemaStrings;
    const methodAbi = this.getMethodAbi(schema, 'BURN');
    const params = [dto.from, this.getAmountOrTokenID(dto, poolLocator.type)];
    poolLocator.schema.includes('WithData') && params.push(encodeHex(dto.data ?? ''));

    const response = await lastValueFrom(
      this.http.post<EthConnectAsyncResponse>(
        `${this.baseUrl}`,
        {
          headers: {
            type: sendTransactionHeader,
          },
          from: dto.signer,
          to: poolLocator.address,
          method: methodAbi,
          params,
        } as EthConnectMsgRequest,
        this.postOptions(dto.signer, dto.requestId),
      ),
    );
    return { id: response.data.id };
  }

  async approval(dto: TokenApproval): Promise<AsyncResponse> {
    const poolLocator = unpackPoolLocator(dto.poolLocator);
    if (!this.validatePoolLocator(poolLocator)) {
      throw new BadRequestException('Invalid pool locator');
    }

    let methodAbi: IAbiMethod | undefined;
    const params: any[] = [];
    const schema = poolLocator.schema as ContractSchemaStrings;

    switch (poolLocator.type) {
      case TokenType.FUNGIBLE: {
        // Not approved means 0 allowance; approved with no allowance means unlimited allowance
        const allowance = !dto.approved ? '0' : dto.config?.allowance ?? UINT256_MAX.toString();
        params.push(dto.operator, allowance);
        methodAbi = this.getMethodAbi(schema, 'APPROVE');
        break;
      }
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

    poolLocator.schema.includes('WithData') && params.push(encodeHex(dto.data ?? ''));
    const response = await lastValueFrom(
      this.http.post<EthConnectAsyncResponse>(
        `${this.baseUrl}`,
        {
          headers: {
            type: sendTransactionHeader,
          },
          from: dto.signer,
          to: poolLocator.address,
          method: methodAbi,
          params,
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

  /**
   * Generate an event ID in the recognized FireFly format for Ethereum
   * (zero-padded block number, transaction index, and log index)
   */
  private formatBlockchainEventId(event: Event) {
    const blockNumber = event.blockNumber ?? '0';
    const txIndex = BigInt(event.transactionIndex).toString(10);
    const logIndex = event.logIndex ?? '0';
    return [
      blockNumber.padStart(12, '0'),
      txIndex.padStart(6, '0'),
      logIndex.padStart(6, '0'),
    ].join('/');
  }

  private stripParamsFromSignature(signature: string) {
    return signature.substring(0, signature.indexOf('('));
  }

  private async transformTransferEvent(
    subName: string,
    event: TransferEvent,
  ): Promise<WebSocketMessage | undefined> {
    const { data: output } = event;
    const unpackedSub = unpackSubscriptionName(this.service.topic, subName);
    const decodedData = decodeHex(event.inputArgs?.data ?? '');

    if (output.from === ZERO_ADDRESS && output.to === ZERO_ADDRESS) {
      // should not happen
      return undefined;
    }
    if (unpackedSub.poolLocator === undefined) {
      // should not happen
      return undefined;
    }

    const eventId = this.formatBlockchainEventId(event);
    const poolLocator = unpackPoolLocator(unpackedSub.poolLocator);
    const commonData = {
      id: eventId,
      poolLocator: unpackedSub.poolLocator,
      amount: poolLocator.type === TokenType.FUNGIBLE ? output.value : '1',
      signer: event.inputSigner,
      data: decodedData,
      blockchain: {
        id: eventId,
        name: this.stripParamsFromSignature(event.signature),
        location: 'address=' + event.address,
        signature: event.signature,
        timestamp: event.timestamp,
        output,
        info: {
          address: event.address,
          blockNumber: event.blockNumber,
          transactionIndex: event.transactionIndex,
          transactionHash: event.transactionHash,
          logIndex: event.logIndex,
          signature: event.signature,
        },
      },
    } as TokenTransferEvent;

    if (poolLocator.type === TokenType.NONFUNGIBLE && output.tokenId !== undefined) {
      commonData.tokenIndex = output.tokenId;
      commonData.uri = await this.getTokenUri(
        output.tokenId,
        event.inputSigner ?? '',
        poolLocator.address ?? '',
      );
    }

    if (output.from === ZERO_ADDRESS) {
      return {
        event: 'token-mint',
        data: { ...commonData, to: output.to } as TokenMintEvent,
      };
    } else if (output.to === ZERO_ADDRESS) {
      return {
        event: 'token-burn',
        data: { ...commonData, from: output.from } as TokenBurnEvent,
      };
    } else {
      return {
        event: 'token-transfer',
        data: { ...commonData, from: output.from, to: output.to } as TokenTransferEvent,
      };
    }
  }

  private transformApprovalEvent(
    subName: string,
    event: ApprovalEvent,
  ): WebSocketMessage | undefined {
    const { data: output } = event;
    const unpackedSub = unpackSubscriptionName(this.service.topic, subName);
    const decodedData = decodeHex(event.inputArgs?.data ?? '');

    if (unpackedSub.poolLocator === undefined) {
      // should not happen
      return undefined;
    }
    const poolLocator = unpackPoolLocator(unpackedSub.poolLocator);

    let subject: string | undefined;
    let approved = true;
    if (poolLocator.type === TokenType.FUNGIBLE) {
      subject = `${output.owner}:${output.spender}`;
      approved = BigInt(output.value ?? 0) > BigInt(0);
    } else {
      subject = output.tokenId;
      approved = output.spender !== ZERO_ADDRESS;
    }

    const eventId = this.formatBlockchainEventId(event);
    return {
      event: 'token-approval',
      data: <TokenApprovalEvent>{
        id: eventId,
        subject,
        type: poolLocator.type,
        poolLocator: unpackedSub.poolLocator,
        operator: output.spender,
        approved,
        signer: output.owner,
        data: decodedData,
        blockchain: {
          id: eventId,
          name: this.stripParamsFromSignature(event.signature),
          location: 'address=' + event.address,
          signature: event.signature,
          timestamp: event.timestamp,
          output,
          info: {
            blockNumber: event.blockNumber,
            transactionIndex: event.transactionIndex,
            transactionHash: event.transactionHash,
            logIndex: event.logIndex,
            address: event.address,
            signature: event.signature,
          },
        },
      },
    };
  }

  private transformApprovalForAllEvent(
    subName: string,
    event: ApprovalForAllEvent,
  ): WebSocketMessage | undefined {
    const { data: output } = event;
    const unpackedSub = unpackSubscriptionName(this.service.topic, subName);
    const decodedData = decodeHex(event.inputArgs?.data ?? '');

    if (unpackedSub.poolLocator === undefined) {
      // should not happen
      return undefined;
    }
    const poolLocator = unpackPoolLocator(unpackedSub.poolLocator);

    const eventId = this.formatBlockchainEventId(event);
    return {
      event: 'token-approval',
      data: <TokenApprovalEvent>{
        id: eventId,
        subject: `${output.owner}:${output.operator}`,
        type: poolLocator.type,
        poolLocator: unpackedSub.poolLocator,
        operator: output.operator,
        approved: output.approved,
        signer: output.owner,
        data: decodedData,
        blockchain: {
          id: eventId,
          name: this.stripParamsFromSignature(event.signature),
          location: 'address=' + event.address,
          signature: event.signature,
          timestamp: event.timestamp,
          output,
          info: {
            blockNumber: event.blockNumber,
            transactionIndex: event.transactionIndex,
            transactionHash: event.transactionHash,
            logIndex: event.logIndex,
            address: event.address,
            signature: event.signature,
          },
        },
      },
    };
  }
}
