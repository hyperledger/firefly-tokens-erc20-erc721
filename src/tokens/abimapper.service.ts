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

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import LRUCache from 'lru-cache';
import { Context } from '../request-context/request-context.decorator';
import ERC20NoDataABI from '../abi/ERC20NoData.json';
import ERC20NoDataLegacyABI from '../abi/ERC20NoDataLegacy.json';
import ERC20WithDataABI from '../abi/ERC20WithData.json';
import ERC721NoDataABI from '../abi/ERC721NoData.json';
import ERC721NoDataLegacyABI from '../abi/ERC721NoDataLegacy.json';
import ERC721WithDataV2ABI from '../abi/ERC721WithDataV2.json';
import ERC721WithDataV1bABI from '../abi/ERC721WithDataV1b.json';
import ERC721WithDataV1aABI from '../abi/ERC721WithDataV1a.json';
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

// Interface identifier for IERC20WithData
const ERC20WithDataIID = '0xaefdad0f';

// Interface identifier for IERC721WithData
const ERC721WithDataV2IID = '0xaefe69bf'; // current version
const ERC721WithDataV1bIID = '0x8706707d'; // no auto-indexing
const ERC721WithDataV1aIID = '0xb2429c12'; // no mintWithURI or baseTokenUri

// Interface identifier for ITokenFactory
const TokenFactoryIID = '0x83a74a0c';

const tokenCreateMethod = 'create';
const tokenCreateEvent = 'TokenPoolCreation';

@Injectable()
export class AbiMapperService {
  private readonly logger = new Logger(AbiMapperService.name);
  private supportCache: LRUCache<string, boolean>;
  private legacyERC20 = false;
  private legacyERC721 = false;

  constructor(private blockchain: BlockchainConnectorService) {
    this.supportCache = new LRUCache<string, boolean>({ max: 500 });
  }

  configure(legacyERC20: boolean, legacyERC721: boolean) {
    this.legacyERC20 = legacyERC20;
    this.legacyERC721 = legacyERC721;
  }

  async getTokenSchema(
    ctx: Context,
    type: TokenType,
    address: string,
  ): Promise<ContractSchemaStrings> {
    if (type === TokenType.NONFUNGIBLE) {
      if (await this.supportsInterface(ctx, address, ERC721WithDataV2IID)) {
        return 'ERC721WithDataV2';
      } else if (
        (await this.supportsInterface(ctx, address, ERC721WithDataV1bIID)) ||
        (await this.supportsInterface(ctx, address, ERC721WithDataV1aIID))
      ) {
        // Note: no change was introduced in schema string for 1a vs. 1b
        // This must be sorted out with a secondary check in getAbi()
        return 'ERC721WithData';
      } else {
        return 'ERC721NoData';
      }
    } else {
      if (await this.supportsInterface(ctx, address, ERC20WithDataIID)) {
        return 'ERC20WithData';
      } else {
        return 'ERC20NoData';
      }
    }
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

  async getAbi(ctx: Context, schema: ContractSchemaStrings, address: string) {
    switch (schema) {
      case 'ERC721WithDataV2':
        return ERC721WithDataV2ABI.abi;
      case 'ERC721WithData':
        // This schema string was reused for two versions of the interface,
        // so we have to check each time (but the results are cached for efficiency)
        return (await this.supportsInterface(ctx, address, ERC721WithDataV1bIID))
          ? ERC721WithDataV1bABI.abi
          : ERC721WithDataV1aABI.abi;
      case 'ERC721NoData':
        return this.legacyERC721 ? ERC721NoDataLegacyABI.abi : ERC721NoDataABI.abi;
      case 'ERC20WithData':
        return ERC20WithDataABI.abi;
      case 'ERC20NoData':
        return this.legacyERC20 ? ERC20NoDataLegacyABI.abi : ERC20NoDataABI.abi;
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

  getAllMethods(abi: IAbiMethod[], signatures: MethodSignature[]) {
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

  async getCreateMethodAndParams(ctx: Context, address: string, dto: TokenPool) {
    const isFungible = dto.type === TokenType.FUNGIBLE;
    const encodedData = encodeHex(dto.data ?? '');
    const method = this.getCreateMethod();
    if (method === undefined) {
      throw new BadRequestException('Failed to parse factory contract ABI');
    }
    const params = [dto.name, dto.symbol, isFungible, encodedData];
    const uriSupport = await this.supportsInterface(ctx, address, TokenFactoryIID);
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
      this.logger.log(`Querying interface '${iid}' support on contract '${address}': ${support}`);
    } catch (err) {
      this.logger.log(
        `Querying interface '${iid}' support on contract '${address}': failed (assuming false)`,
      );
    }

    this.supportCache.set(cacheKey, support);
    return support;
  }

  async getDecimals(ctx: Context, address: string) {
    const response = await this.blockchain.query(ctx, address, Decimals, []);
    return parseInt(response.output) || 0;
  }
}
