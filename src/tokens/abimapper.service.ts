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

import { Injectable, Logger } from '@nestjs/common';
import LRUCache from 'lru-cache';
import { Context } from '../request-context/request-context.decorator';
import ERC20NoDataABI from '../abi/ERC20NoData.json';
import ERC20WithDataABI from '../abi/ERC20WithData.json';
import ERC721NoDataABI from '../abi/ERC721NoData.json';
import ERC721WithDataABI from '../abi/ERC721WithData.json';
import IERC165ABI from '../abi/IERC165.json';
import { BlockchainConnectorService } from './blockchain.service';
import { ContractSchemaStrings, IAbiMethod, TokenType } from './tokens.interfaces';

const abiSchemaMap = new Map<ContractSchemaStrings, IAbiMethod[]>();
abiSchemaMap.set('ERC20NoData', ERC20NoDataABI.abi);
abiSchemaMap.set('ERC20WithData', ERC20WithDataABI.abi);
abiSchemaMap.set('ERC721NoData', ERC721NoDataABI.abi);
abiSchemaMap.set('ERC721WithData', ERC721WithDataABI.abi);

const ERC20WithDataIID = '0xaefdad0f';
const ERC721WithDataIID = '0xb2429c12';
const ERC721WithDataUriIID = '0x8706707d';
const TokenFactoryIID = '0x83a74a0c';
const supportsInterfaceABI = IERC165ABI.abi.find(m => m.name === 'supportsInterface');

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
  URI: string | null;
}

export interface AbiEvents {
  TRANSFER: string;
  APPROVAL: string;
  APPROVALFORALL: string | null;
}

const abiMethodMap = new Map<ContractSchemaStrings, AbiMethods & Record<string, string | null>>();
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
  URI: null,
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
  URI: null,
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
  URI: 'tokenURI',
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
  URI: null,
});

const abiEventMap = new Map<ContractSchemaStrings, AbiEvents & Record<string, string | null>>();
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

  allMethods(schema: ContractSchemaStrings) {
    const names: string[] = [];
    const methods = abiMethodMap.get(schema);
    for (const method of Object.values(methods ?? {})) {
      if (method !== null) {
        names.push(method);
      }
    }
    return names;
  }

  allInvokeMethods(schema: ContractSchemaStrings) {
    const excluded = ['NAME', 'SYMBOL', 'DECIMALS', 'URI', 'BASEURI'];
    const names: string[] = [];
    const methods = abiMethodMap.get(schema);
    for (const [key, method] of Object.entries(methods ?? {})) {
      if (!excluded.includes(key) && method !== null) {
        names.push(method);
      }
    }
    return names;
  }

  allEvents(schema: ContractSchemaStrings) {
    const names: string[] = [];
    const events = abiEventMap.get(schema);
    for (const method of Object.values(events ?? {})) {
      if (method !== null) {
        names.push(method);
      }
    }
    return names;
  }

  getAbi(schema: ContractSchemaStrings) {
    return abiSchemaMap.get(schema);
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

  getEventAbi(schema: ContractSchemaStrings, operation: keyof AbiEvents): IAbiMethod | undefined {
    const contractAbi = abiSchemaMap.get(schema);
    const abiEvents = abiEventMap.get(schema);
    if (contractAbi === undefined || abiEvents === undefined) {
      return undefined;
    }
    return contractAbi.find(abi => abi.name === abiEvents[operation]);
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
