// Copyright © 2024 Kaleido, Inc.
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
import { EventStream } from '../event-stream/event-stream.interfaces';
import { EventStreamService } from '../event-stream/event-stream.service';
import { EventStreamProxyGateway } from '../eventstream-proxy/eventstream-proxy.gateway';
import { Context } from '../request-context/request-context.decorator';
import {
  AsyncResponse,
  CheckInterfaceRequest,
  CheckInterfaceResponse,
  IAbiMethod,
  InterfaceFormat,
  IPoolLocator,
  IValidPoolLocator,
  TokenApproval,
  TokenBurn,
  TokenInterface,
  TokenMint,
  TokenPool,
  TokenPoolActivate,
  TokenPoolConfig,
  TokenPoolDeactivate,
  TokenPoolEvent,
  TokenTransfer,
  TokenType,
} from './tokens.interfaces';
import {
  packPoolLocator,
  packSubscriptionName,
  unpackPoolLocator,
  unpackSubscriptionName,
  validatePoolLocator,
} from './tokens.util';
import { TokenListener } from './tokens.listener';
import { AbiMapperService } from './abimapper.service';
import { BlockchainConnectorService } from './blockchain.service';
import {
  Approval as ERC20Approval,
  Transfer as ERC20Transfer,
  Name as ERC20Name,
  Symbol as ERC20Symbol,
  DynamicMethods as ERC20Methods,
} from './erc20';
import {
  Approval as ERC721Approval,
  ApprovalForAll as ERC721ApprovalForAll,
  Transfer as ERC721Transfer,
  Name as ERC721Name,
  Symbol as ERC721Symbol,
  DynamicMethods as ERC721Methods,
} from './erc721';
import { eventStreamName } from '../utils';

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  baseUrl: string;
  topic: string;
  streamCache: Map<string, EventStream> = new Map();
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
    this.proxy.addEventListener(new TokenListener(this.mapper, this.blockchain));
    const wsUrl = new URL('/ws', this.baseUrl.replace('http', 'ws')).href;
    this.proxy.configure(wsUrl, this.topic);
  }

  private async getOrCreateFactorySubscription(ctx: Context, address: string, namespace: string) {
    const eventABI = this.mapper.getCreateEvent();
    const methodABI = this.mapper.getCreateMethod();
    const stream = await this.getStream(ctx, namespace);
    if (eventABI !== undefined && methodABI !== undefined && stream !== undefined) {
      await this.eventstream.getOrCreateSubscription(
        ctx,
        this.baseUrl,
        eventABI,
        stream.id,
        packSubscriptionName(address, eventABI.name),
        address,
        [methodABI],
        '0',
      );
    }
  }

  private async getStream(ctx: Context, namespace: string) {
    let stream = this.streamCache.get(namespace);
    if (stream !== undefined) {
      return stream;
    }
    await this.migrationCheck(ctx);
    this.logger.log('Creating stream with name ' + eventStreamName(this.topic, namespace));
    stream = await this.eventstream.createOrUpdateStream(
      ctx,
      eventStreamName(this.topic, namespace),
      this.topic,
    );
    this.streamCache.set(namespace, stream);
    return stream;
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

    const createABI = this.mapper.getCreateEvent();
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
      if (parts.event === createABI?.name) {
        // Skip "create" subscriptions (assume they are factories)
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
      const allEvents = this.mapper.allEvents(unpackedLocator.type === TokenType.FUNGIBLE);
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
    const nameABI = poolLocator.type === TokenType.FUNGIBLE ? ERC20Name : ERC721Name;
    const nameResponse = await this.blockchain.query(ctx, poolLocator.address, nameABI, []);
    if (nameResponse?.output === undefined) {
      throw new NotFoundException('Unable to query token name');
    }

    const symbolABI = poolLocator.type === TokenType.FUNGIBLE ? ERC20Symbol : ERC721Symbol;
    const symbolResponse = await this.blockchain.query(ctx, poolLocator.address, symbolABI, []);
    if (symbolResponse?.output === undefined) {
      throw new NotFoundException('Unable to query token symbol');
    }

    const decimals =
      poolLocator.type === TokenType.FUNGIBLE
        ? await this.mapper.getDecimals(ctx, poolLocator.address)
        : 0;

    return {
      name: nameResponse.output,
      symbol: symbolResponse.output,
      decimals,
    };
  }

  async createPool(ctx: Context, dto: TokenPool): Promise<TokenPoolEvent | AsyncResponse> {
    const contractAddress = dto.config?.address || undefined;
    if (contractAddress !== undefined) {
      this.logger.log(`Create token pool from existing: '${contractAddress}'`);
      return this.createFromExisting(ctx, contractAddress, dto);
    }

    const factoryAddress = dto.config?.factoryAddress || this.factoryAddress || undefined;
    if (factoryAddress === undefined) {
      throw new BadRequestException(
        'config.address was unspecified, and no token factory is configured!',
      );
    }
    this.logger.log(`Create token pool from factory: '${factoryAddress}'`);
    return this.createFromFactory(ctx, factoryAddress, dto);
  }

  private async createFromExisting(
    ctx: Context,
    address: string,
    dto: TokenPool,
  ): Promise<TokenPoolEvent> {
    const schema = await this.mapper.getTokenSchema(ctx, dto.type, address);
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

    return {
      namespace: dto.namespace,
      data: dto.data,
      poolLocator: packPoolLocator(poolLocator),
      standard: dto.type === TokenType.FUNGIBLE ? 'ERC20' : 'ERC721',
      interfaceFormat: InterfaceFormat.ABI,
      type: dto.type,
      symbol: poolInfo.symbol,
      decimals: poolInfo.decimals,
      info: {
        name: poolInfo.name,
        address,
        schema,
      },
    };
  }

  private async createFromFactory(
    ctx: Context,
    address: string,
    dto: TokenPool,
  ): Promise<AsyncResponse> {
    await this.getOrCreateFactorySubscription(ctx, address, dto.namespace);
    const { method, params } = await this.mapper.getCreateMethodAndParams(ctx, address, dto);
    const response = await this.blockchain.sendTransaction(
      ctx,
      dto.signer,
      address,
      dto.requestId,
      method,
      params,
    );
    return { id: response.id };
  }

  private getSubscriptionBlockNumber(config?: TokenPoolConfig): string {
    if (config?.blockNumber !== undefined && config.blockNumber !== '') {
      return config.blockNumber;
    } else {
      return '0';
    }
  }

  private getEventAbis(poolLocator: IValidPoolLocator) {
    const transferAbi = poolLocator.type === TokenType.FUNGIBLE ? ERC20Transfer : ERC721Transfer;
    if (transferAbi?.name === undefined) {
      throw new NotFoundException('Transfer event ABI not found');
    }
    const approvalAbi = poolLocator.type === TokenType.FUNGIBLE ? ERC20Approval : ERC721Approval;
    if (approvalAbi?.name === undefined) {
      throw new NotFoundException('Approval event ABI not found');
    }
    const approvalForAllAbi =
      poolLocator.type === TokenType.FUNGIBLE ? undefined : ERC721ApprovalForAll;
    return {
      transferAbi,
      approvalAbi,
      approvalForAllAbi,
    };
  }

  async activatePool(ctx: Context, dto: TokenPoolActivate) {
    const poolLocator = unpackPoolLocator(dto.poolLocator);
    if (!validatePoolLocator(poolLocator)) {
      throw new BadRequestException('Invalid pool locator');
    }

    const abi = await this.mapper.getAbi(ctx, poolLocator.schema, poolLocator.address);
    const possibleMethods = this.mapper.allInvokeMethods(
      abi,
      poolLocator.type === TokenType.FUNGIBLE,
    );
    const eventAbis = this.getEventAbis(poolLocator);
    const stream = await this.getStream(ctx, dto.namespace);

    const promises = [
      this.eventstream.getOrCreateSubscription(
        ctx,
        this.baseUrl,
        eventAbis.transferAbi,
        stream.id,
        packSubscriptionName(dto.poolLocator, eventAbis.transferAbi.name, dto.poolData),
        poolLocator.address,
        possibleMethods,
        this.getSubscriptionBlockNumber(dto.config),
      ),
      this.eventstream.getOrCreateSubscription(
        ctx,
        this.baseUrl,
        eventAbis.approvalAbi,
        stream.id,
        packSubscriptionName(dto.poolLocator, eventAbis.approvalAbi.name, dto.poolData),
        poolLocator.address,
        possibleMethods,
        this.getSubscriptionBlockNumber(dto.config),
      ),
    ];
    if (eventAbis.approvalForAllAbi?.name !== undefined) {
      promises.push(
        this.eventstream.getOrCreateSubscription(
          ctx,
          this.baseUrl,
          eventAbis.approvalForAllAbi,
          stream.id,
          packSubscriptionName(dto.poolLocator, eventAbis.approvalForAllAbi.name, dto.poolData),
          poolLocator.address,
          possibleMethods,
          this.getSubscriptionBlockNumber(dto.config),
        ),
      );
    }
    await Promise.all(promises);

    const poolInfo = await this.queryPool(ctx, poolLocator);
    const tokenPoolEvent: TokenPoolEvent = {
      namespace: dto.namespace,
      poolData: dto.poolData,
      poolLocator: dto.poolLocator,
      standard: poolLocator.type === TokenType.FUNGIBLE ? 'ERC20' : 'ERC721',
      interfaceFormat: InterfaceFormat.ABI,
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

  async deactivatePool(ctx: Context, dto: TokenPoolDeactivate) {
    const poolLocator = unpackPoolLocator(dto.poolLocator);
    if (!validatePoolLocator(poolLocator)) {
      throw new BadRequestException('Invalid pool locator');
    }

    const stream = await this.getStream(ctx, dto.namespace);
    const eventAbis = this.getEventAbis(poolLocator);
    const promises = [
      this.eventstream.deleteSubscriptionByName(
        ctx,
        stream.id,
        packSubscriptionName(dto.poolLocator, eventAbis.transferAbi.name, dto.poolData),
      ),
      this.eventstream.deleteSubscriptionByName(
        ctx,
        stream.id,
        packSubscriptionName(dto.poolLocator, eventAbis.approvalAbi.name, dto.poolData),
      ),
    ];
    if (eventAbis.approvalForAllAbi?.name !== undefined) {
      promises.push(
        this.eventstream.deleteSubscriptionByName(
          ctx,
          stream.id,
          packSubscriptionName(dto.poolLocator, eventAbis.approvalForAllAbi.name, dto.poolData),
        ),
      );
    }

    const results = await Promise.all(promises);
    if (results.every(deleted => !deleted)) {
      throw new NotFoundException('No listeners found');
    }
  }

  checkInterface(dto: CheckInterfaceRequest): CheckInterfaceResponse {
    const poolLocator = unpackPoolLocator(dto.poolLocator);
    if (!validatePoolLocator(poolLocator)) {
      throw new BadRequestException('Invalid pool locator');
    }

    const wrapMethods = (methods: IAbiMethod[]): TokenInterface => {
      return { format: InterfaceFormat.ABI, methods };
    };

    const methods = poolLocator.type === TokenType.FUNGIBLE ? ERC20Methods : ERC721Methods;
    return {
      approval: wrapMethods(this.mapper.getAllMethods(dto.methods, methods.approval)),
      burn: wrapMethods(this.mapper.getAllMethods(dto.methods, methods.burn)),
      mint: wrapMethods(this.mapper.getAllMethods(dto.methods, methods.mint)),
      transfer: wrapMethods(this.mapper.getAllMethods(dto.methods, methods.transfer)),
    };
  }

  async mint(ctx: Context, dto: TokenMint): Promise<AsyncResponse> {
    const poolLocator = unpackPoolLocator(dto.poolLocator);
    if (!validatePoolLocator(poolLocator)) {
      throw new BadRequestException('Invalid pool locator');
    }

    const abi =
      dto.interface?.methods ||
      (await this.mapper.getAbi(ctx, poolLocator.schema, poolLocator.address));
    const { method, params } = this.mapper.getMethodAndParams(
      abi,
      poolLocator.type === TokenType.FUNGIBLE,
      'mint',
      dto,
    );
    const response = await this.blockchain.sendTransaction(
      ctx,
      dto.signer,
      poolLocator.address,
      dto.requestId,
      method,
      params,
    );
    return { id: response.id };
  }

  async transfer(ctx: Context, dto: TokenTransfer): Promise<AsyncResponse> {
    const poolLocator = unpackPoolLocator(dto.poolLocator);
    if (!validatePoolLocator(poolLocator)) {
      throw new BadRequestException('Invalid pool locator');
    }

    const abi =
      dto.interface?.methods ||
      (await this.mapper.getAbi(ctx, poolLocator.schema, poolLocator.address));
    const { method, params } = this.mapper.getMethodAndParams(
      abi,
      poolLocator.type === TokenType.FUNGIBLE,
      'transfer',
      dto,
    );
    const response = await this.blockchain.sendTransaction(
      ctx,
      dto.signer,
      poolLocator.address,
      dto.requestId,
      method,
      params,
    );
    return { id: response.id };
  }

  async burn(ctx: Context, dto: TokenBurn): Promise<AsyncResponse> {
    const poolLocator = unpackPoolLocator(dto.poolLocator);
    if (!validatePoolLocator(poolLocator)) {
      throw new BadRequestException('Invalid pool locator');
    }

    const abi =
      dto.interface?.methods ||
      (await this.mapper.getAbi(ctx, poolLocator.schema, poolLocator.address));
    const { method, params } = this.mapper.getMethodAndParams(
      abi,
      poolLocator.type === TokenType.FUNGIBLE,
      'burn',
      dto,
    );
    const response = await this.blockchain.sendTransaction(
      ctx,
      dto.signer,
      poolLocator.address,
      dto.requestId,
      method,
      params,
    );
    return { id: response.id };
  }

  async approval(ctx: Context, dto: TokenApproval): Promise<AsyncResponse> {
    const poolLocator = unpackPoolLocator(dto.poolLocator);
    if (!validatePoolLocator(poolLocator)) {
      throw new BadRequestException('Invalid pool locator');
    }

    const abi =
      dto.interface?.methods ||
      (await this.mapper.getAbi(ctx, poolLocator.schema, poolLocator.address));
    const { method, params } = this.mapper.getMethodAndParams(
      abi,
      poolLocator.type === TokenType.FUNGIBLE,
      'approval',
      dto,
    );
    const response = await this.blockchain.sendTransaction(
      ctx,
      dto.signer,
      poolLocator.address,
      dto.requestId,
      method,
      params,
    );
    return { id: response.id };
  }
}
