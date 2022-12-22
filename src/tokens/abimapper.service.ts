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
import ERC721WithURIABI from '../abi/ERC721WithData.json';
import ERC721WithDataABI from '../abi/ERC721WithDataOld.json';
import IERC165ABI from '../abi/IERC165.json';
import { BlockchainConnectorService } from './blockchain.service';
import { ERC20Events, ERC721Events } from './events';
import { erc20Methods, erc721Methods, MethodSignature, OpTypes } from './supportedmethods';
import { ContractSchemaStrings, IAbiMethod, TokenType } from './tokens.interfaces';

const abiSchemaMap = new Map<ContractSchemaStrings, IAbiMethod[]>();
abiSchemaMap.set('ERC20NoData', ERC20NoDataABI.abi);
abiSchemaMap.set('ERC20WithData', ERC20WithDataABI.abi);
abiSchemaMap.set('ERC721NoData', ERC721NoDataABI.abi);
abiSchemaMap.set('ERC721WithData', ERC721WithURIABI.abi);

const ERC20WithDataIID = '0xaefdad0f';
const ERC721WithDataIID = '0xb2429c12';
const ERC721WithDataUriIID = '0x8706707d';
const TokenFactoryIID = '0x83a74a0c';
const supportsInterfaceABI = IERC165ABI.abi.find(m => m.name === 'supportsInterface');

export interface AbiMethods {
  NAME: string;
  SYMBOL: string;
  DECIMALS: string | null;
  BASEURI: string | null;
  URI: string | null;
}

const abiMethodMap = new Map<ContractSchemaStrings, AbiMethods & Record<string, string | null>>();
abiMethodMap.set('ERC20NoData', {
  NAME: 'name',
  SYMBOL: 'symbol',
  DECIMALS: 'decimals',
  BASEURI: null,
  URI: null,
});
abiMethodMap.set('ERC20WithData', {
  NAME: 'name',
  SYMBOL: 'symbol',
  DECIMALS: 'decimals',
  BASEURI: null,
  URI: null,
});
abiMethodMap.set('ERC721WithData', {
  NAME: 'name',
  SYMBOL: 'symbol',
  DECIMALS: null,
  BASEURI: 'baseTokenUri',
  URI: 'tokenURI',
});
abiMethodMap.set('ERC721NoData', {
  NAME: 'name',
  SYMBOL: 'symbol',
  DECIMALS: null,
  BASEURI: null,
  URI: null,
});

@Injectable()
export class AbiMapperService {
  private readonly logger = new Logger(AbiMapperService.name);
  private uriSupportCache: LRUCache<string, boolean>;

  constructor(private blockchain: BlockchainConnectorService) {
    this.uriSupportCache = new LRUCache<string, boolean>({ max: 500 });
  }

  getTokenSchema(type: TokenType, withData = true): ContractSchemaStrings {
    if (type === TokenType.FUNGIBLE) {
      return withData ? 'ERC20WithData' : 'ERC20NoData';
    }
    return withData ? 'ERC721WithData' : 'ERC721NoData';
  }

  allInvokeMethods(schema: ContractSchemaStrings) {
    const allSignatures = schema.startsWith('ERC20')
      ? [
          ...erc20Methods.approve,
          ...erc20Methods.burn,
          ...erc20Methods.mint,
          ...erc20Methods.transfer,
        ]
      : [
          ...erc721Methods.approve,
          ...erc721Methods.burn,
          ...erc721Methods.mint,
          ...erc721Methods.transfer,
        ];
    return this.findAllMatches(this.getAbi(schema), allSignatures);
  }

  allEvents(schema: ContractSchemaStrings) {
    const events = schema.startsWith('ERC20') ? ERC20Events : ERC721Events;
    return events.map(event => event.name);
  }

  getAbi(schema: ContractSchemaStrings, uriSupport = true) {
    if (schema === 'ERC721WithData' && uriSupport === false) {
      // Special case outside the schema map
      // ERC721WithURI is a strict superset of ERC721WithData with a few extra methods.
      // Assume the URI methods exist, unless uriSupport is explicitly set to false.
      return ERC721WithDataABI.abi;
    }
    const abi = abiSchemaMap.get(schema);
    if (abi === undefined) {
      throw new BadRequestException(`Unknown schema: ${schema}`);
    }
    return abi;
  }

  private findAllMatches(abi: IAbiMethod[], signatures: MethodSignature[]) {
    const methods: IAbiMethod[] = [];
    for (const signature of signatures) {
      for (const method of abi) {
        if (signature.name === method.name && signature.inputs.length === method.inputs?.length) {
          let matched = true;
          for (let i = 0; i < signature.inputs.length; i++) {
            if (
              signature.inputs[i].name !== method.inputs[i].name ||
              signature.inputs[i].type !== method.inputs[i].type
            ) {
              matched = false;
              break;
            }
          }
          if (matched) {
            methods.push(method);
          }
        }
      }
    }
    return methods;
  }

  private findFirstMatch(abi: IAbiMethod[], signatures: MethodSignature[], dto?: any) {
    for (const signature of signatures) {
      for (const method of abi) {
        if (signature.name === method.name && signature.inputs.length === method.inputs?.length) {
          let matched = true;
          for (let i = 0; i < signature.inputs.length; i++) {
            if (
              signature.inputs[i].name !== method.inputs[i].name ||
              signature.inputs[i].type !== method.inputs[i].type
            ) {
              matched = false;
              break;
            }
          }
          if (matched) {
            const params = signature.map(dto);
            if (params !== undefined) {
              return { method, params };
            }
          }
        }
      }
    }
    return {};
  }

  getMethodAndParams(
    schema: ContractSchemaStrings,
    operation: OpTypes,
    dto: any,
    uriSupport?: boolean,
  ) {
    const abi = this.getAbi(schema, uriSupport);
    return schema.startsWith('ERC20')
      ? this.findFirstMatch(abi, erc20Methods[operation], dto)
      : this.findFirstMatch(abi, erc721Methods[operation], dto);
  }

  getMethodAbi(schema: ContractSchemaStrings, operation: keyof AbiMethods): IAbiMethod | undefined {
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
      const result = await this.blockchain.query(ctx, address, supportsInterfaceABI, [iid]);
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
      const result = await this.blockchain.query(
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
}
