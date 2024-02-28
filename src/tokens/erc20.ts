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

import {
  MethodSignature,
  TokenOperation,
  TokenApproval,
  TokenBurn,
  TokenMint,
  TokenTransfer,
} from './tokens.interfaces';
import { encodeHex } from './tokens.util';

const UINT256_MAX = BigInt(2) ** BigInt(256) - BigInt(1);

// Methods defined as part of the ERC20 standard
// Although these are "optional" in the standard, they are currently
// required by this connector.

export const Name = {
  name: 'name',
  type: 'function',
  stateMutability: 'view',
  inputs: [],
  outputs: [
    {
      internalType: 'string',
      name: '',
      type: 'string',
    },
  ],
};

export const Symbol = {
  name: 'symbol',
  type: 'function',
  stateMutability: 'view',
  inputs: [],
  outputs: [
    {
      internalType: 'string',
      name: '',
      type: 'string',
    },
  ],
};

export const Decimals = {
  name: 'decimals',
  type: 'function',
  stateMutability: 'view',
  inputs: [],
  outputs: [
    {
      internalType: 'uint8',
      name: '',
      type: 'uint8',
    },
  ],
};

// Events defined as part of the ERC20 standard

export const Transfer = {
  name: 'Transfer',
  type: 'event',
  anonymous: false,
  inputs: [
    {
      indexed: true,
      internalType: 'address',
      name: 'from',
      type: 'address',
    },
    {
      indexed: true,
      internalType: 'address',
      name: 'to',
      type: 'address',
    },
    {
      indexed: false,
      internalType: 'uint256',
      name: 'value',
      type: 'uint256',
    },
  ],
};

export const Approval = {
  name: 'Approval',
  type: 'event',
  inputs: [
    {
      indexed: true,
      internalType: 'address',
      name: 'owner',
      type: 'address',
    },
    {
      indexed: true,
      internalType: 'address',
      name: 'spender',
      type: 'address',
    },
    {
      indexed: false,
      internalType: 'uint256',
      name: 'value',
      type: 'uint256',
    },
  ],
};

export const AllEvents = [Transfer, Approval];

// Methods which have many possible forms
// These may include extensions defined by FireFly, extensions defined by
// OpenZeppelin, and methods that are part of the base standard.
// Each operation type is a prioritized list of methods to be used if defined.

export const DynamicMethods: Record<TokenOperation, MethodSignature[]> = {
  approval: [
    {
      // Source: FireFly extension
      name: 'approveWithData',
      inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }],
      map: (dto: TokenApproval) => {
        // Not approved means 0 allowance; approved with no allowance means unlimited allowance
        const allowance = !dto.approved ? '0' : dto.config?.allowance ?? UINT256_MAX.toString();
        return [dto.operator, allowance, encodeHex(dto.data ?? '')];
      },
    },
    {
      // Source: base standard
      name: 'approve',
      inputs: [{ type: 'address' }, { type: 'uint256' }],
      map: (dto: TokenApproval) => {
        // Not approved means 0 allowance; approved with no allowance means unlimited allowance
        const allowance = !dto.approved ? '0' : dto.config?.allowance ?? UINT256_MAX.toString();
        return [dto.operator, allowance];
      },
    },
  ],

  burn: [
    {
      // Source: FireFly extension
      name: 'burnWithData',
      inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }],
      map: (dto: TokenBurn) => {
        return [dto.from, dto.amount, encodeHex(dto.data ?? '')];
      },
    },
    {
      // Source: OpenZeppelin extension
      name: 'burn',
      inputs: [{ type: 'uint256' }],
      map: (dto: TokenBurn) => {
        if (dto.from === dto.signer) {
          // Can only be used to burn the signer's tokens
          return [dto.amount];
        }
        return undefined;
      },
    },
    {
      // Source: OpenZeppelin extension
      name: 'burnFrom',
      inputs: [{ type: 'address' }, { type: 'uint256' }],
      map: (dto: TokenBurn) => {
        return [dto.from, dto.amount];
      },
    },
    {
      // Source: Legacy sample contract
      name: 'burn',
      inputs: [{ type: 'address' }, { type: 'uint256' }],
      map: (dto: TokenBurn) => {
        return [dto.from, dto.amount];
      },
    },
  ],

  mint: [
    {
      // Source: FireFly extension
      name: 'mintWithData',
      inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }],
      map: (dto: TokenMint) => {
        return [dto.to, dto.amount, encodeHex(dto.data ?? '')];
      },
    },
    {
      // Source: OpenZeppelin extension
      name: 'mint',
      inputs: [{ type: 'address' }, { type: 'uint256' }],
      map: (dto: TokenMint) => {
        return [dto.to, dto.amount];
      },
    },
  ],

  transfer: [
    {
      // Source: FireFly extension
      name: 'transferWithData',
      inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'bytes' }],
      map: (dto: TokenTransfer) => {
        return [dto.from, dto.to, dto.amount, encodeHex(dto.data ?? '')];
      },
    },
    {
      // Source: base standard
      name: 'transfer',
      inputs: [{ type: 'address' }, { type: 'uint256' }],
      map: (dto: TokenTransfer) => {
        if (dto.from === dto.signer) {
          // Can only be used to transfer from the signer's address
          return [dto.to, dto.amount];
        }
        return undefined;
      },
    },
    {
      // Source: base standard
      name: 'transferFrom',
      inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
      map: (dto: TokenTransfer) => {
        return [dto.from, dto.to, dto.amount];
      },
    },
  ],
};
