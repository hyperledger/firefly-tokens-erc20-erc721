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

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import LRUCache from 'lru-cache';
import { Context } from '../request-context/request-context.decorator';
import ERC20NoDataABI from '../abi/ERC20NoData.json';
import ERC20WithDataABI from '../abi/ERC20WithData.json';
import ERC721NoDataABI from '../abi/ERC721NoData.json';
import ERC721WithDataABI from '../abi/ERC721WithData.json';
import ERC721WithDataOldABI from '../abi/ERC721WithDataOld.json';
import TokenFactoryABI from '../abi/TokenFactory.json';
import { BlockchainConnectorService } from './blockchain.service';
import { SupportsInterface } from './erc165';
import { AllEvents as ERC20Events, Decimals, DynamicMethods as ERC20Methods } from './erc20';
import { AllEvents as ERC721Events, DynamicMethods as ERC721Methods } from './erc721';
import {
  ContractSchemaStrings,
  IAbiMethod,
  MethodSignature,
  TokenOperation,
  TokenPool,
  TokenType,
} from './tokens.interfaces';
import { encodeHex } from './tokens.util';

// The current version of IERC20WithData
const ERC20WithDataIID = '0xaefdad0f';

// The current version of IERC721WithData
const ERC721WithDataIID = '0x8706707d';

// The previous version of IERC721WithData (no mintWithURI or baseTokenUri)
const ERC721WithDataOldIID = '0xb2429c12';

// The current version of ITokenFactory
const TokenFactoryIID = '0x83a74a0c';

const tokenCreateMethod = 'create';
const tokenCreateEvent = 'TokenPoolCreation';

@Injectable()
export class AbiMapperService {
  private readonly logger = new Logger(AbiMapperService.name);
  private supportCache: LRUCache<string, boolean>;

  constructor(private blockchain: BlockchainConnectorService) {
    this.supportCache = new LRUCache<string, boolean>({ max: 500 });
  }

  getTokenSchema(type: TokenType, withData = true): ContractSchemaStrings {
    if (type === TokenType.FUNGIBLE) {
      return withData ? 'ERC20WithData' : 'ERC20NoData';
    }
    return withData ? 'ERC721WithData' : 'ERC721NoData';
  }

  allInvokeMethods(abi: IAbiMethod[], isFungible: boolean) {
    const allSignatures = isFungible
      ? [
          ...ERC20Methods.approval,
          ...ERC20Methods.burn,
          ...ERC20Methods.mint,
          ...ERC20Methods.transfer,
        ]
      : [
          ...ERC721Methods.approval,
          ...ERC721Methods.burn,
          ...ERC721Methods.mint,
          ...ERC721Methods.transfer,
        ];
    return this.getAllMethods(abi, allSignatures);
  }

  allEvents(isFungible: boolean) {
    const events = isFungible ? ERC20Events : ERC721Events;
    return events.map(event => event.name);
  }

  getAbi(schema: ContractSchemaStrings, uriSupport = true) {
    switch (schema) {
      case 'ERC721WithData':
        if (uriSupport === false) {
          // The newer ERC721WithData schema is a strict superset of the old, with a
          // few new methods around URIs. Assume the URI methods exist, unless
          // uriSupport is explicitly set to false.
          return ERC721WithDataOldABI.abi;
        }
        return ERC721WithDataABI.abi;
      case 'ERC721NoData':
        return ERC721NoDataABI.abi;
      case 'ERC20WithData':
        return ERC20WithDataABI.abi;
      case 'ERC20NoData':
        return ERC20NoDataABI.abi;
      default:
        throw new BadRequestException(`Unknown schema: ${schema}`);
    }
  }

  private signatureMatch(method: IAbiMethod, signature: MethodSignature) {
    if (signature.name !== method.name || signature.inputs.length !== method.inputs?.length) {
      return false;
    }
    for (let i = 0; i < signature.inputs.length; i++) {
      if (signature.inputs[i].type !== method.inputs[i].type) {
        return false;
      }
    }
    return true;
  }

  private getAllMethods(abi: IAbiMethod[], signatures: MethodSignature[]) {
    const methods: IAbiMethod[] = [];
    for (const signature of signatures) {
      for (const method of abi) {
        if (this.signatureMatch(method, signature)) {
          methods.push(method);
        }
      }
    }
    return methods;
  }

  getMethodAndParams(abi: IAbiMethod[], isFungible: boolean, operation: TokenOperation, dto: any) {
    const signatures = isFungible ? ERC20Methods[operation] : ERC721Methods[operation];
    for (const signature of signatures) {
      for (const method of abi) {
        if (this.signatureMatch(method, signature)) {
          const params = signature.map(dto);
          if (params !== undefined) {
            return { method, params };
          }
        }
      }
    }
    return {};
  }

  getCreateMethod() {
    return TokenFactoryABI.abi.find(m => m.name === tokenCreateMethod);
  }

  getCreateEvent() {
    return TokenFactoryABI.abi.find(m => m.name === tokenCreateEvent);
  }

  getCreateMethodAndParams(dto: TokenPool, uriSupport = true) {
    const isFungible = dto.type === TokenType.FUNGIBLE;
    const encodedData = encodeHex(dto.data ?? '');
    const method = this.getCreateMethod();
    if (method === undefined) {
      throw new BadRequestException('Failed to parse factory contract ABI');
    }
    const params = [dto.name, dto.symbol, isFungible, encodedData];
    if (uriSupport) {
      // supply empty string if URI isn't provided
      // the contract itself handles empty base URIs appropriately
      params.push(dto.config?.uri !== undefined ? dto.config.uri : '');
    }
    return { method, params };
  }

  private async supportsInterface(ctx: Context, address: string, iid: string) {
    const cacheKey = `${address}:${iid}`;
    const cached = this.supportCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    let support = false;
    try {
      const result = await this.blockchain.query(ctx, address, SupportsInterface, [iid]);
      support = result.output === true;
    } catch (err) {
      // do nothing
    }

    this.supportCache.set(cacheKey, support);
    return support;
  }

  async supportsData(ctx: Context, address: string, type: TokenType) {
    let result = false;
    switch (type) {
      case TokenType.NONFUNGIBLE:
        result =
          (await this.supportsInterface(ctx, address, ERC721WithDataIID)) ||
          (await this.supportsInterface(ctx, address, ERC721WithDataOldIID));
        break;
      case TokenType.FUNGIBLE:
      default:
        result = await this.supportsInterface(ctx, address, ERC20WithDataIID);
        break;
    }

    this.logger.log(`Querying extra data support on contract '${address}': ${result}`);
    return result;
  }

  async supportsMintWithUri(ctx: Context, address: string): Promise<boolean> {
    const result = await this.supportsInterface(ctx, address, ERC721WithDataIID);
    this.logger.log(`Querying URI support on contract '${address}': ${result}`);
    return result;
  }

  async supportsFactoryWithUri(ctx: Context, address: string): Promise<boolean> {
    const result = await this.supportsInterface(ctx, address, TokenFactoryIID);
    this.logger.log(`Querying URI support on contract '${address}': ${result}`);
    return result;
  }

  async getDecimals(ctx: Context, address: string) {
    const response = await this.blockchain.query(ctx, address, Decimals, []);
    return parseInt(response.output) || 0;
  }
}
