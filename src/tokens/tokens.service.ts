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

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import TokenFactoryABI from '../abi/TokenFactory.json';
import { EventStream } from '../event-stream/event-stream.interfaces';
import { EventStreamService } from '../event-stream/event-stream.service';
import { EventStreamProxyGateway } from '../eventstream-proxy/eventstream-proxy.gateway';
import { Context, newContext } from '../request-context/request-context.decorator';
import {
  AsyncResponse,
  IAbiMethod,
  IPoolLocator,
  IValidPoolLocator,
  TokenApproval,
  TokenBurn,
  TokenMint,
  TokenPool,
  TokenPoolActivate,
  TokenPoolConfig,
  TokenPoolEvent,
  TokenTransfer,
  TokenType,
  TokenPoolEventInfo,
} from './tokens.interfaces';
import {
  encodeHex,
  packPoolLocator,
  packSubscriptionName,
  unpackPoolLocator,
  unpackSubscriptionName,
  validatePoolLocator,
} from './tokens.util';
import { TokenListener } from './tokens.listener';
import { AbiMapperService } from './abimapper.service';
import { BlockchainConnectorService } from './blockchain.service';

const tokenCreateMethod = 'create';
const tokenCreateEvent = 'TokenPoolCreation';

const UINT256_MAX = BigInt(2) ** BigInt(256) - BigInt(1);
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  baseUrl: string;
  topic: string;
  stream: EventStream;
  factoryAddress = '';

  constructor(
    private eventstream: EventStreamService,
    private proxy: EventStreamProxyGateway,
    private mapper: AbiMapperService,
    private blockchain: BlockchainConnectorService,
  ) {}

  configure(baseUrl: string, topic: string, factoryAddress: string) {
    this.baseUrl = baseUrl;
    this.topic = topic;
    this.factoryAddress = factoryAddress.toLowerCase();
    this.proxy.addConnectionListener(this);
    this.proxy.addEventListener(new TokenListener(this, this.mapper, this.blockchain));
  }

  async onConnect() {
    const wsUrl = new URL('/ws', this.baseUrl.replace('http', 'ws')).href;
    const stream = await this.getStream(newContext());
    this.proxy.configure(wsUrl, stream.name);
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
      const allEvents = this.mapper.allEvents(unpackedLocator.schema);
      if (allEvents.length === 0) {
        this.logger.warn(
          `Could not determine schema from pool locator: '${parts.poolLocator}'. ` +
            `This pool may not behave as expected.`,
        );
        return true;
      }
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

  private async queryPool(ctx: Context, poolLocator: IValidPoolLocator) {
    const nameResponse = await this.blockchain.query(
      ctx,
      poolLocator.address,
      this.mapper.getMethodAbi(poolLocator.schema, 'NAME'),
      [],
    );
    const symbolResponse = await this.blockchain.query(
      ctx,
      poolLocator.address,
      this.mapper.getMethodAbi(poolLocator.schema, 'SYMBOL'),
      [],
    );

    if (nameResponse?.output === undefined || symbolResponse?.output === undefined) {
      throw new NotFoundException('Unable to query token contract');
    }

    let decimals = 0;
    const decimalsMethod = this.mapper.getMethodAbi(poolLocator.schema, 'DECIMALS');
    if (decimalsMethod !== undefined) {
      const decimalsResponse = await this.blockchain.query(
        ctx,
        poolLocator.address,
        decimalsMethod,
        [],
      );
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
      supportsCustomUri = await this.mapper.supportsNFTUri(ctx, address, false);
    }

    const withData = supportsCustomUri
      ? true
      : await this.mapper.supportsData(ctx, address, dto.type);
    const schema = this.mapper.getTokenSchema(dto.type, withData);
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
      const method = this.mapper.getMethodAbi(schema, 'BASEURI');
      if (method !== undefined) {
        const baseUriResponse = await this.blockchain.query(ctx, poolLocator.address, method, []);
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
    const uri = await this.mapper.supportsNFTUri(ctx, this.factoryAddress, true);
    if (uri === true) {
      // supply empty string if URI isn't provided
      // the contract itself handles empty base URI's appropriately
      params.push(dto.config?.uri !== undefined ? dto.config.uri : '');
    }

    const response = await this.blockchain.sendTransaction(
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

    const stream = await this.getStream(ctx);
    const transferAbi = this.mapper.getEventAbi(poolLocator.schema, 'TRANSFER');
    if (transferAbi?.name === undefined) {
      throw new NotFoundException('Transfer event ABI not found');
    }
    const approvalAbi = this.mapper.getEventAbi(poolLocator.schema, 'APPROVAL');
    if (approvalAbi?.name === undefined) {
      throw new NotFoundException('Approval event ABI not found');
    }
    const approvalForAllAbi = this.mapper.getEventAbi(poolLocator.schema, 'APPROVALFORALL');

    const contractAbi = this.mapper.getAbi(poolLocator.schema);
    const possibleMethods = this.mapper.allInvokeMethods(poolLocator.schema);
    if (possibleMethods.length === 0 || contractAbi === undefined) {
      throw new BadRequestException(`Unknown schema: ${poolLocator.schema}`);
    }
    const methodsToSubTo: IAbiMethod[] = contractAbi.filter(
      method => method.name !== undefined && possibleMethods.includes(method.name),
    );

    const promises = [
      this.eventstream.getOrCreateSubscription(
        ctx,
        this.baseUrl,
        transferAbi,
        stream.id,
        packSubscriptionName(dto.poolLocator, transferAbi.name, dto.poolData),
        poolLocator.address,
        methodsToSubTo,
        this.getSubscriptionBlockNumber(dto.config),
      ),
      this.eventstream.getOrCreateSubscription(
        ctx,
        this.baseUrl,
        approvalAbi,
        stream.id,
        packSubscriptionName(dto.poolLocator, approvalAbi.name, dto.poolData),
        poolLocator.address,
        methodsToSubTo,
        this.getSubscriptionBlockNumber(dto.config),
      ),
    ];
    if (approvalForAllAbi?.name !== undefined) {
      promises.push(
        this.eventstream.getOrCreateSubscription(
          ctx,
          this.baseUrl,
          approvalForAllAbi,
          stream.id,
          packSubscriptionName(dto.poolLocator, approvalForAllAbi.name, dto.poolData),
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
      supportsUri = await this.mapper.supportsNFTUri(ctx, poolLocator.address, false);
    }

    const methodAbi = this.mapper.getMethodAbi(
      poolLocator.schema,
      supportsUri ? 'MINTURI' : 'MINT',
    );
    const params = [dto.to, this.getAmountOrTokenID(dto, poolLocator.type)];
    poolLocator.schema.includes('WithData') && params.push(encodeHex(dto.data ?? ''));
    supportsUri && params.push(dto.uri);

    const response = await this.blockchain.sendTransaction(
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

    const methodAbi = this.mapper.getMethodAbi(poolLocator.schema, 'TRANSFER');
    const params = [dto.from, dto.to, this.getAmountOrTokenID(dto, poolLocator.type)];
    poolLocator.schema.includes('WithData') && params.push(encodeHex(dto.data ?? ''));

    const response = await this.blockchain.sendTransaction(
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

    const methodAbi = this.mapper.getMethodAbi(poolLocator.schema, 'BURN');
    const params = [dto.from, this.getAmountOrTokenID(dto, poolLocator.type)];
    poolLocator.schema.includes('WithData') && params.push(encodeHex(dto.data ?? ''));

    const response = await this.blockchain.sendTransaction(
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

    switch (poolLocator.type) {
      case TokenType.FUNGIBLE: {
        // Not approved means 0 allowance; approved with no allowance means unlimited allowance
        const allowance = !dto.approved ? '0' : dto.config?.allowance ?? UINT256_MAX.toString();
        params.push(dto.operator, allowance);
        methodAbi = this.mapper.getMethodAbi(poolLocator.schema, 'APPROVE');
        break;
      }
      case TokenType.NONFUNGIBLE:
        if (dto.config?.tokenIndex !== undefined) {
          // Not approved means setting approved operator to 0
          const operator = !dto.approved ? ZERO_ADDRESS : dto.operator;
          params.push(operator, dto.config.tokenIndex);
          methodAbi = this.mapper.getMethodAbi(poolLocator.schema, 'APPROVE');
        } else {
          params.push(dto.operator, dto.approved);
          methodAbi = this.mapper.getMethodAbi(poolLocator.schema, 'APPROVEFORALL');
        }
        break;
    }

    poolLocator.schema.includes('WithData') && params.push(encodeHex(dto.data ?? ''));
    const response = await this.blockchain.sendTransaction(
      ctx,
      dto.signer,
      poolLocator.address,
      dto.requestId,
      methodAbi,
      params,
    );
    return { id: response.id };
  }
}
