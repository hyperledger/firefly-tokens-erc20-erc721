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

import { ClientRequest } from 'http';
import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { lastValueFrom } from 'rxjs';
import LRUCache from 'lru-cache';
import ERC20NoDataABI from '../abi/ERC20NoData.json';
import ERC20WithDataABI from '../abi/ERC20WithData.json';
import ERC721NoDataABI from '../abi/ERC721NoData.json';
import ERC721WithDataABI from '../abi/ERC721WithData.json';
import TokenFactoryABI from '../abi/TokenFactory.json';
import IERC165ABI from '../abi/IERC165.json';
import { Event, EventStream, EventStreamReply } from '../event-stream/event-stream.interfaces';
import { EventStreamService } from '../event-stream/event-stream.service';
import { EventStreamProxyGateway } from '../eventstream-proxy/eventstream-proxy.gateway';
import { EventListener, EventProcessor } from '../eventstream-proxy/eventstream-proxy.interfaces';
import { basicAuth } from '../utils';
import { WebSocketMessage } from '../websocket-events/websocket-events.base';
import {
  ERC20ApprovalEvent,
  ERC721ApprovalEvent,
  ApprovalForAllEvent,
  AsyncResponse,
  ContractSchema,
  EthConnectAsyncResponse,
  EthConnectReturn,
  IAbiMethod,
  IPoolLocator,
  IValidPoolLocator,
  TokenApproval,
  TokenApprovalEvent,
  TokenBurn,
  TokenBurnEvent,
  TokenPoolCreationEvent,
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
  TokenPoolEventInfo,
} from './tokens.interfaces';
import {
  decodeHex,
  encodeHex,
  getTokenSchema,
  packPoolLocator,
  packSubscriptionName,
  unpackPoolLocator,
  unpackSubscriptionName,
  validatePoolLocator,
} from './tokens.util';
import { FFRequestIDHeader } from '../request-context/constants';
import { Context, newContext } from '../request-context/request-context.decorator';

const ERC20WithDataIID = '0xaefdad0f';
const ERC721WithDataIID = '0xb2429c12';
const ERC721WithDataUriIID = '0x8706707d';
const TokenFactoryIID = '0x83a74a0c';
const supportsInterfaceABI = IERC165ABI.abi.find(m => m.name === 'supportsInterface');

export const abiSchemaMap = new Map<ContractSchemaStrings, IAbiMethod[]>();
abiSchemaMap.set('ERC20NoData', ERC20NoDataABI.abi);
abiSchemaMap.set('ERC20WithData', ERC20WithDataABI.abi);
abiSchemaMap.set('ERC721NoData', ERC721NoDataABI.abi);
abiSchemaMap.set('ERC721WithData', ERC721WithDataABI.abi);

export interface AbiMethods {
  MINT: string;
  MINTURI: string | null;
  TRANSFER: string;
  BURN: string;
  NAME: string;
  SYMBOL: string;
  APPROVE: string;
  APPROVEFORALL: string | null;
  DECIMALS: string | null;
  BASEURI: string | null;
}

export interface AbiEvents {
  TRANSFER: string;
  APPROVAL: string;
  APPROVALFORALL: string | null;
}

const abiMethodMap = new Map<ContractSchemaStrings, AbiMethods>();
abiMethodMap.set('ERC20NoData', {
  MINT: 'mint',
  MINTURI: null,
  TRANSFER: 'transferFrom',
  BURN: 'burn',
  APPROVE: 'approve',
  APPROVEFORALL: null,
  NAME: 'name',
  SYMBOL: 'symbol',
  DECIMALS: 'decimals',
  BASEURI: null,
});
abiMethodMap.set('ERC20WithData', {
  MINT: 'mintWithData',
  MINTURI: null,
  TRANSFER: 'transferWithData',
  BURN: 'burnWithData',
  APPROVE: 'approveWithData',
  APPROVEFORALL: null,
  NAME: 'name',
  SYMBOL: 'symbol',
  DECIMALS: 'decimals',
  BASEURI: null,
});
abiMethodMap.set('ERC721WithData', {
  MINT: 'mintWithData',
  MINTURI: 'mintWithURI',
  TRANSFER: 'transferWithData',
  BURN: 'burnWithData',
  APPROVE: 'approveWithData',
  APPROVEFORALL: 'setApprovalForAllWithData',
  NAME: 'name',
  SYMBOL: 'symbol',
  DECIMALS: null,
  BASEURI: 'baseTokenUri',
});
abiMethodMap.set('ERC721NoData', {
  MINT: 'mint',
  MINTURI: null,
  TRANSFER: 'safeTransferFrom',
  BURN: 'burn',
  APPROVE: 'approve',
  APPROVEFORALL: 'setApprovalForAll',
  NAME: 'name',
  SYMBOL: 'symbol',
  DECIMALS: null,
  BASEURI: null,
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

const tokenCreateMethod = 'create';
const tokenCreateEvent = 'TokenPoolCreation';
const tokenCreateEventSignature = 'TokenPoolCreation(address,string,string,bool,bytes)';

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
  // cache tracking if a contract address supports custom URI's
  private uriSupportCache: LRUCache<string, boolean>;

  baseUrl: string;
  fftmUrl: string;
  topic: string;
  shortPrefix: string;
  stream: EventStream;
  username: string;
  password: string;
  factoryAddress = '';
  passthroughHeaders: string[];

  constructor(
    public http: HttpService,
    private eventstream: EventStreamService,
    private proxy: EventStreamProxyGateway,
  ) {
    this.uriSupportCache = new LRUCache<string, boolean>({ max: 500 });
  }

  configure(
    baseUrl: string,
    fftmUrl: string,
    topic: string,
    shortPrefix: string,
    username: string,
    password: string,
    factoryAddress: string,
    passthroughHeaders: string[],
  ) {
    this.baseUrl = baseUrl;
    this.fftmUrl = fftmUrl;
    this.topic = topic;
    this.shortPrefix = shortPrefix;
    this.username = username;
    this.password = password;
    this.factoryAddress = factoryAddress.toLowerCase();
    this.passthroughHeaders = passthroughHeaders;
    this.proxy.addConnectionListener(this);
    this.proxy.addEventListener(new TokenListener(this));
  }

  async onConnect() {
    const wsUrl = new URL('/ws', this.baseUrl.replace('http', 'ws')).href;
    const stream = await this.getStream(newContext());
    this.proxy.configure(wsUrl, stream.name);
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
    const name = abiMethods[operation] ?? undefined;
    if (name === undefined) {
      return undefined;
    }
    return contractAbi.find(abi => abi.name === name);
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

  /**
   * One-time initialization of event stream and base subscription.
   */
  async init(ctx: Context) {
    this.stream = await this.getStream(ctx);
    if (this.factoryAddress !== '') {
      const eventABI = TokenFactoryABI.abi.find(m => m.name === tokenCreateEvent);
      const methodABI = TokenFactoryABI.abi.find(m => m.name === tokenCreateMethod);
      if (eventABI !== undefined && methodABI !== undefined) {
        await this.eventstream.getOrCreateSubscription(
          ctx,
          this.baseUrl,
          eventABI,
          this.stream.id,
          tokenCreateEvent,
          packSubscriptionName(this.factoryAddress, tokenCreateEvent),
          this.factoryAddress,
          [methodABI],
          '0',
        );
      }
    }
  }

  private async getStream(ctx: Context) {
    const stream = this.stream;
    if (stream !== undefined) {
      return stream;
    }
    await this.migrationCheck(ctx);
    this.logger.log('Creating stream with name ' + this.topic);
    this.stream = await this.eventstream.createOrUpdateStream(ctx, this.topic, this.topic);
    return this.stream;
  }

  /**
   * Check for existing event streams and subscriptions that don't match the current
   * expected format (ie incorrect names, missing event subscriptions).
   *
   * Log a warning if any potential issues are flagged. User may need to delete
   * subscriptions manually and reactivate the pool directly.
   */
  async migrationCheck(ctx: Context): Promise<boolean> {
    const streams = await this.eventstream.getStreams(ctx);
    const existingStream = streams.find(s => s.name === this.topic);
    if (existingStream === undefined) {
      return false;
    }

    const allSubscriptions = await this.eventstream.getSubscriptions(ctx);
    const subscriptions = allSubscriptions.filter(s => s.stream === existingStream.id);
    if (subscriptions.length === 0) {
      return false;
    }

    const foundEvents = new Map<string, string[]>();
    for (const sub of subscriptions) {
      const parts = unpackSubscriptionName(sub.name);
      if (parts.poolLocator === undefined || parts.event === undefined) {
        this.logger.warn(
          `Non-parseable subscription name '${sub.name}' found in event stream '${existingStream.name}'.` +
            `It is recommended to delete all subscriptions and activate all pools again.`,
        );
        return true;
      }
      if (parts.poolLocator === this.factoryAddress) {
        continue;
      }
      const key = packSubscriptionName(parts.poolLocator, '', parts.poolData);
      const existing = foundEvents.get(key);
      if (existing !== undefined) {
        existing.push(parts.event);
      } else {
        foundEvents.set(key, [parts.event]);
      }
    }

    // Expect to have found subscriptions for each of the events.
    for (const [key, events] of foundEvents) {
      const parts = unpackSubscriptionName(key);
      const unpackedLocator = unpackPoolLocator(parts.poolLocator ?? '');
      if (!validatePoolLocator(unpackedLocator)) {
        this.logger.warn(
          `Could not parse pool locator: '${parts.poolLocator}'. ` +
            `This pool may not behave as expected.`,
        );
        return true;
      }
      const abiEvents = abiEventMap.get(unpackedLocator.schema as ContractSchemaStrings);
      if (abiEvents === undefined) {
        this.logger.warn(
          `Could not determine schema from pool locator: '${parts.poolLocator}'. ` +
            `This pool may not behave as expected.`,
        );
        return true;
      }
      const allEvents: string[] = [];
      [abiEvents.TRANSFER, abiEvents.APPROVAL, abiEvents.APPROVALFORALL].forEach(
        ev => ev !== null && allEvents.push(ev),
      );
      if (
        allEvents.length !== events.length ||
        !allEvents.every(event => event === null || events.includes(event))
      ) {
        this.logger.warn(
          `Event stream subscriptions for pool '${parts.poolLocator}' do not include all expected events ` +
            `(${allEvents}). Events may not be properly delivered to this pool. ` +
            `It is recommended to delete its subscriptions and activate the pool again.`,
        );
        return true;
      }
    }
    return false;
  }

  private requestOptions(ctx: Context): AxiosRequestConfig {
    const headers = {};
    for (const key of this.passthroughHeaders) {
      const value = ctx.headers[key];
      if (value) {
        headers[key] = value;
      }
    }
    headers[FFRequestIDHeader] = ctx.requestId;
    const config = basicAuth(this.username, this.password);
    config.headers = headers;
    return config;
  }

  private async wrapError<T>(response: Promise<AxiosResponse<T>>) {
    return response.catch(err => {
      if (axios.isAxiosError(err)) {
        const request: ClientRequest | undefined = err.request;
        const response: AxiosResponse | undefined = err.response;
        const errorMessage = response?.data?.error ?? err.message;
        this.logger.warn(
          `${request?.path} <-- HTTP ${response?.status} ${response?.statusText}: ${errorMessage}`,
        );
        throw new InternalServerErrorException(errorMessage);
      }
      throw err;
    });
  }

  async query(ctx: Context, to: string, method?: IAbiMethod, params?: any[]) {
    const response = await this.wrapError(
      lastValueFrom(
        this.http.post<EthConnectReturn>(
          this.baseUrl,
          { headers: { type: queryHeader }, to, method, params },
          this.requestOptions(ctx),
        ),
      ),
    );
    return response.data;
  }

  async sendTransaction(
    ctx: Context,
    from: string,
    to: string,
    id?: string,
    method?: IAbiMethod,
    params?: any[],
  ) {
    const url = this.fftmUrl !== undefined && this.fftmUrl !== '' ? this.fftmUrl : this.baseUrl;
    const response = await this.wrapError(
      lastValueFrom(
        this.http.post<EthConnectAsyncResponse>(
          url,
          { headers: { id, type: sendTransactionHeader }, from, to, method, params },
          this.requestOptions(ctx),
        ),
      ),
    );
    return response.data;
  }

  async supportsData(ctx: Context, address: string, type: TokenType) {
    if (type === TokenType.NONFUNGIBLE) {
      if (await this.supportsNFTUri(ctx, address, false)) {
        return true;
      }
    }

    let iid: string;
    switch (type) {
      case TokenType.NONFUNGIBLE:
        iid = ERC721WithDataIID;
        break;
      case TokenType.FUNGIBLE:
      default:
        iid = ERC20WithDataIID;
        break;
    }

    try {
      const result = await this.query(ctx, address, supportsInterfaceABI, [iid]);
      this.logger.log(`Querying extra data support on contract '${address}': ${result.output}`);
      return result.output === true;
    } catch (err) {
      this.logger.log(
        `Failed to query extra data support on contract '${address}': assuming false`,
      );
      return false;
    }
  }

  async supportsNFTUri(ctx: Context, address: string, factory: boolean): Promise<boolean> {
    const support = this.uriSupportCache.get(address);
    if (support !== undefined) {
      return support;
    }

    try {
      const result = await this.query(
        ctx,
        address,
        supportsInterfaceABI,
        factory ? [TokenFactoryIID] : [ERC721WithDataUriIID],
      );
      this.logger.log(`Querying URI support on contract '${address}': ${result.output}`);
      this.uriSupportCache.set(address, result.output);
      return result.output === true;
    } catch (err) {
      this.logger.log(`Failed to query URI support on contract '${address}': assuming false`);
      return false;
    }
  }

  private async queryPool(ctx: Context, poolLocator: IValidPoolLocator) {
    const schema = poolLocator.schema as ContractSchemaStrings;

    const nameResponse = await this.query(
      ctx,
      poolLocator.address,
      this.getMethodAbi(schema, 'NAME'),
      [],
    );
    const symbolResponse = await this.query(
      ctx,
      poolLocator.address,
      this.getMethodAbi(schema, 'SYMBOL'),
      [],
    );

    if (nameResponse?.output === undefined || symbolResponse?.output === undefined) {
      throw new NotFoundException('Unable to query token contract');
    }

    let decimals = 0;
    const decimalsMethod = this.getMethodAbi(schema, 'DECIMALS');
    if (decimalsMethod !== undefined) {
      const decimalsResponse = await this.query(ctx, poolLocator.address, decimalsMethod, []);
      decimals = parseInt(decimalsResponse.output);
      if (isNaN(decimals)) {
        decimals = 0;
      }
    }

    return {
      name: nameResponse.output,
      symbol: symbolResponse.output,
      decimals,
    };
  }

  async createPool(ctx: Context, dto: TokenPool): Promise<TokenPoolEvent | AsyncResponse> {
    if (dto.config?.address !== undefined && dto.config.address !== '') {
      this.logger.log(`Create token pool from existing: '${dto.config.address}'`);
      return this.createFromExisting(ctx, dto.config.address, dto);
    }
    if (this.factoryAddress === '') {
      throw new BadRequestException(
        'config.address was unspecified, and no token factory is configured!',
      );
    }
    this.logger.log(`Create token pool from factory: '${this.factoryAddress}'`);
    return this.createFromFactory(ctx, dto);
  }

  async createFromExisting(ctx: Context, address: string, dto: TokenPool) {
    let supportsCustomUri = false;
    if (dto.type === TokenType.NONFUNGIBLE) {
      supportsCustomUri = await this.supportsNFTUri(ctx, address, false);
    }

    const withData = supportsCustomUri ? true : await this.supportsData(ctx, address, dto.type);
    const schema = getTokenSchema(dto.type, withData);
    const poolLocator: IPoolLocator = {
      address: address.toLowerCase(),
      type: dto.type,
      schema,
    };
    if (!validatePoolLocator(poolLocator)) {
      throw new BadRequestException('Invalid pool locator');
    }

    const poolInfo = await this.queryPool(ctx, poolLocator);
    if (dto.symbol !== undefined && dto.symbol !== '' && dto.symbol !== poolInfo.symbol) {
      throw new BadRequestException(
        `Supplied symbol '${dto.symbol}' does not match expected '${poolInfo.symbol}'`,
      );
    }

    const eventInfo: TokenPoolEventInfo = {
      name: poolInfo.name,
      address,
      schema,
    };

    if (supportsCustomUri) {
      const method = this.getMethodAbi(schema as ContractSchemaStrings, 'BASEURI');
      if (method !== undefined) {
        const baseUriResponse = await this.query(ctx, poolLocator.address, method, []);
        eventInfo.uri = baseUriResponse.output;
      }
    }

    const tokenPoolEvent: TokenPoolEvent = {
      data: dto.data,
      poolLocator: packPoolLocator(poolLocator),
      standard: dto.type === TokenType.FUNGIBLE ? 'ERC20' : 'ERC721',
      type: dto.type,
      symbol: poolInfo.symbol,
      decimals: poolInfo.decimals,
      info: eventInfo,
    };
    return tokenPoolEvent;
  }

  async createFromFactory(ctx: Context, dto: TokenPool): Promise<AsyncResponse> {
    const isFungible = dto.type === TokenType.FUNGIBLE;
    const encodedData = encodeHex(dto.data ?? '');
    const method = TokenFactoryABI.abi.find(m => m.name === tokenCreateMethod);
    if (method === undefined) {
      throw new BadRequestException('Failed to parse factory contract ABI');
    }
    const params = [dto.name, dto.symbol, isFungible, encodedData];
    const uri = await this.supportsNFTUri(ctx, this.factoryAddress, true);
    if (uri === true) {
      // supply empty string if URI isn't provided
      // the contract itself handles empty base URI's appropriately
      params.push(dto.config?.uri !== undefined ? dto.config.uri : '');
    }

    const response = await this.sendTransaction(
      ctx,
      dto.signer,
      this.factoryAddress,
      dto.requestId,
      method,
      params,
    );
    return { id: response.id };
  }

  getSubscriptionBlockNumber(config?: TokenPoolConfig): string {
    if (config?.blockNumber !== undefined && config.blockNumber !== '') {
      return config.blockNumber;
    } else {
      return '0';
    }
  }

  async activatePool(ctx: Context, dto: TokenPoolActivate) {
    const poolLocator = unpackPoolLocator(dto.poolLocator);
    if (!validatePoolLocator(poolLocator)) {
      throw new BadRequestException('Invalid pool locator');
    }

    const schema = poolLocator.schema as ContractSchemaStrings;
    const stream = await this.getStream(ctx);
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

    const possibleMethods: string[] = Object.values(abiMethods).filter(
      m => !['name', 'symbol', 'decimals'].includes(m),
    );
    const methodsToSubTo: IAbiMethod[] = contractAbi.filter(
      method => method.name !== undefined && possibleMethods.includes(method.name),
    );

    const promises = [
      this.eventstream.getOrCreateSubscription(
        ctx,
        this.baseUrl,
        transferAbi,
        stream.id,
        abiEvents.TRANSFER,
        packSubscriptionName(dto.poolLocator, abiEvents.TRANSFER, dto.poolData),
        poolLocator.address,
        methodsToSubTo,
        this.getSubscriptionBlockNumber(dto.config),
      ),
      this.eventstream.getOrCreateSubscription(
        ctx,
        this.baseUrl,
        approvalAbi,
        stream.id,
        abiEvents.APPROVAL,
        packSubscriptionName(dto.poolLocator, abiEvents.APPROVAL, dto.poolData),
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
          ctx,
          this.baseUrl,
          approvalForAllAbi,
          stream.id,
          abiEvents.APPROVALFORALL,
          packSubscriptionName(dto.poolLocator, abiEvents.APPROVALFORALL, dto.poolData),
          poolLocator.address,
          methodsToSubTo,
          this.getSubscriptionBlockNumber(dto.config),
        ),
      );
    }
    await Promise.all(promises);

    const poolInfo = await this.queryPool(ctx, poolLocator);
    const tokenPoolEvent: TokenPoolEvent = {
      poolLocator: dto.poolLocator,
      standard: poolLocator.type === TokenType.FUNGIBLE ? 'ERC20' : 'ERC721',
      type: poolLocator.type,
      symbol: poolInfo.symbol,
      decimals: poolInfo.decimals,
      info: {
        name: poolInfo.name,
        address: poolLocator.address,
        schema: poolLocator.schema,
      },
    };

    return tokenPoolEvent;
  }

  async mint(ctx: Context, dto: TokenMint): Promise<AsyncResponse> {
    const poolLocator = unpackPoolLocator(dto.poolLocator);
    if (!validatePoolLocator(poolLocator)) {
      throw new BadRequestException('Invalid pool locator');
    }

    let supportsUri = false;
    if (dto.uri !== undefined) {
      supportsUri = await this.supportsNFTUri(ctx, poolLocator.address, false);
    }

    const schema = poolLocator.schema as ContractSchemaStrings;
    const methodAbi = this.getMethodAbi(schema, supportsUri ? 'MINTURI' : 'MINT');
    const params = [dto.to, this.getAmountOrTokenID(dto, poolLocator.type)];
    poolLocator.schema.includes('WithData') && params.push(encodeHex(dto.data ?? ''));
    supportsUri && params.push(dto.uri);

    const response = await this.sendTransaction(
      ctx,
      dto.signer,
      poolLocator.address,
      dto.requestId,
      methodAbi,
      params,
    );
    return { id: response.id };
  }

  async transfer(ctx: Context, dto: TokenTransfer): Promise<AsyncResponse> {
    const poolLocator = unpackPoolLocator(dto.poolLocator);
    if (!validatePoolLocator(poolLocator)) {
      throw new BadRequestException('Invalid pool locator');
    }

    const schema = poolLocator.schema as ContractSchemaStrings;
    const methodAbi = this.getMethodAbi(schema, 'TRANSFER');
    const params = [dto.from, dto.to, this.getAmountOrTokenID(dto, poolLocator.type)];
    poolLocator.schema.includes('WithData') && params.push(encodeHex(dto.data ?? ''));

    const response = await this.sendTransaction(
      ctx,
      dto.signer,
      poolLocator.address,
      dto.requestId,
      methodAbi,
      params,
    );
    return { id: response.id };
  }

  async burn(ctx: Context, dto: TokenBurn): Promise<AsyncResponse> {
    const poolLocator = unpackPoolLocator(dto.poolLocator);
    if (!validatePoolLocator(poolLocator)) {
      throw new BadRequestException('Invalid pool locator');
    }

    const schema = poolLocator.schema as ContractSchemaStrings;
    const methodAbi = this.getMethodAbi(schema, 'BURN');
    const params = [dto.from, this.getAmountOrTokenID(dto, poolLocator.type)];
    poolLocator.schema.includes('WithData') && params.push(encodeHex(dto.data ?? ''));

    const response = await this.sendTransaction(
      ctx,
      dto.signer,
      poolLocator.address,
      dto.requestId,
      methodAbi,
      params,
    );
    return { id: response.id };
  }

  async approval(ctx: Context, dto: TokenApproval): Promise<AsyncResponse> {
    const poolLocator = unpackPoolLocator(dto.poolLocator);
    if (!validatePoolLocator(poolLocator)) {
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
    const response = await this.sendTransaction(
      ctx,
      dto.signer,
      poolLocator.address,
      dto.requestId,
      methodAbi,
      params,
    );
    return { id: response.id };
  }

  async getReceipt(ctx: Context, id: string): Promise<EventStreamReply> {
    const response = await this.wrapError(
      lastValueFrom(
        this.http.get<EventStreamReply>(new URL(`/reply/${id}`, this.baseUrl).href, {
          validateStatus: status => status < 300 || status === 404,
          ...basicAuth(this.username, this.password),
        }),
      ),
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
    const signature = this.trimEventSignature(event.signature);
    switch (signature) {
      case tokenCreateEventSignature:
        process(await this.transformTokenPoolCreationEvent(subName, event));
        break;
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
    ctx: Context,
    tokenIdx: string,
    contractAddress: string,
  ): Promise<string> {
    const abiMethods = abiSchemaMap.get('ERC721WithData');
    if (abiMethods === undefined) {
      // should not happen
      return '';
    }

    const methodABI = abiMethods.find(method => method.name === 'tokenURI');
    try {
      const response = await this.service.query(ctx, contractAddress, methodABI, [tokenIdx]);
      return response.output as string;
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

  private trimEventSignature(signature: string) {
    const firstColon = signature.indexOf(':');
    if (firstColon > 0) {
      return signature.substring(firstColon + 1);
    }
    return signature;
  }

  private async transformTokenPoolCreationEvent(
    subName: string,
    event: TokenPoolCreationEvent,
  ): Promise<WebSocketMessage | undefined> {
    const { data: output } = event;
    const decodedData = decodeHex(output.data ?? '');

    if (event.address.toLowerCase() !== this.service.factoryAddress) {
      this.logger.warn(`Ignoring token pool creation from unknown address: ${event.address}`);
      return undefined;
    }

    const type = output.is_fungible ? TokenType.FUNGIBLE : TokenType.NONFUNGIBLE;
    const withData = await this.service.supportsData(newContext(), output.contract_address, type);
    const schema = getTokenSchema(type, withData);
    const poolLocator: IValidPoolLocator = {
      address: output.contract_address.toLowerCase(),
      type,
      schema,
    };

    return {
      event: 'token-pool',
      data: <TokenPoolEvent>{
        standard: type === TokenType.FUNGIBLE ? 'ERC20' : 'ERC721',
        poolLocator: packPoolLocator(poolLocator),
        type,
        signer: event.inputSigner,
        data: decodedData,
        symbol: output.symbol,
        info: {
          name: output.name,
          address: output.contract_address,
          schema,
        },
        blockchain: {
          id: this.formatBlockchainEventId(event),
          name: this.stripParamsFromSignature(this.trimEventSignature(event.signature)),
          location: 'address=' + event.address,
          signature: this.trimEventSignature(event.signature),
          timestamp: event.timestamp,
          output,
          info: {
            blockNumber: event.blockNumber,
            transactionIndex: event.transactionIndex,
            transactionHash: event.transactionHash,
            logIndex: event.logIndex,
            address: event.address,
            signature: this.trimEventSignature(event.signature),
          },
        },
      },
    };
  }

  private async transformTransferEvent(
    subName: string,
    event: TransferEvent,
  ): Promise<WebSocketMessage | undefined> {
    const { data: output } = event;
    const unpackedSub = unpackSubscriptionName(subName);
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
      poolData: unpackedSub.poolData,
      poolLocator: unpackedSub.poolLocator,
      amount: poolLocator.type === TokenType.FUNGIBLE ? output.value : '1',
      signer: event.inputSigner,
      data: decodedData,
      blockchain: {
        id: eventId,
        name: this.stripParamsFromSignature(this.trimEventSignature(event.signature)),
        location: 'address=' + event.address,
        signature: this.trimEventSignature(event.signature),
        timestamp: event.timestamp,
        output,
        info: {
          address: event.address,
          blockNumber: event.blockNumber,
          transactionIndex: event.transactionIndex,
          transactionHash: event.transactionHash,
          logIndex: event.logIndex,
          signature: this.trimEventSignature(event.signature),
        },
      },
    } as TokenTransferEvent;

    if (poolLocator.type === TokenType.NONFUNGIBLE && output.tokenId !== undefined) {
      commonData.tokenIndex = output.tokenId;
      commonData.uri = await this.getTokenUri(
        newContext(),
        output.tokenId,
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
    event: ERC20ApprovalEvent | ERC721ApprovalEvent,
  ): WebSocketMessage | undefined {
    const { data: output } = event;
    const unpackedSub = unpackSubscriptionName(subName);
    const decodedData = decodeHex(event.inputArgs?.data ?? '');

    if (unpackedSub.poolLocator === undefined) {
      // should not happen
      return undefined;
    }
    const poolLocator = unpackPoolLocator(unpackedSub.poolLocator);

    let operator: string;
    let subject: string | undefined;
    let approved = true;
    if (poolLocator.type === TokenType.FUNGIBLE) {
      const erc20Event = event as ERC20ApprovalEvent;
      operator = erc20Event.data.spender;
      subject = `${output.owner}:${operator}`;
      approved = BigInt(erc20Event.data.value ?? 0) > BigInt(0);
    } else {
      const erc721Event = event as ERC721ApprovalEvent;
      operator = erc721Event.data.approved;
      subject = erc721Event.data.tokenId;
      approved = operator !== ZERO_ADDRESS;
    }

    const eventId = this.formatBlockchainEventId(event);
    return {
      event: 'token-approval',
      data: <TokenApprovalEvent>{
        id: eventId,
        poolData: unpackedSub.poolData,
        subject,
        poolLocator: unpackedSub.poolLocator,
        operator,
        approved,
        signer: output.owner,
        data: decodedData,
        info: output,
        blockchain: {
          id: eventId,
          name: this.stripParamsFromSignature(this.trimEventSignature(event.signature)),
          location: 'address=' + event.address,
          signature: this.trimEventSignature(event.signature),
          timestamp: event.timestamp,
          output,
          info: {
            blockNumber: event.blockNumber,
            transactionIndex: event.transactionIndex,
            transactionHash: event.transactionHash,
            logIndex: event.logIndex,
            address: event.address,
            signature: this.trimEventSignature(event.signature),
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
    const unpackedSub = unpackSubscriptionName(subName);
    const decodedData = decodeHex(event.inputArgs?.data ?? '');

    if (unpackedSub.poolLocator === undefined) {
      // should not happen
      return undefined;
    }

    const eventId = this.formatBlockchainEventId(event);
    return {
      event: 'token-approval',
      data: <TokenApprovalEvent>{
        id: eventId,
        poolData: unpackedSub.poolData,
        subject: `${output.owner}:${output.operator}`,
        poolLocator: unpackedSub.poolLocator,
        operator: output.operator,
        approved: output.approved,
        signer: output.owner,
        data: decodedData,
        info: output,
        blockchain: {
          id: eventId,
          name: this.stripParamsFromSignature(event.signature),
          location: 'address=' + event.address,
          signature: this.trimEventSignature(event.signature),
          timestamp: event.timestamp,
          output,
          info: {
            blockNumber: event.blockNumber,
            transactionIndex: event.transactionIndex,
            transactionHash: event.transactionHash,
            logIndex: event.logIndex,
            address: event.address,
            signature: this.trimEventSignature(event.signature),
          },
        },
      },
    };
  }
}
