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

import { EncodedPoolIdEnum, ITokenPool, IValidTokenPool, TokenType } from './tokens.interfaces';

/**
 * Encode a UTF-8 string into hex bytes with a leading 0x
 */
export function encodeHex(data: string) {
  const encoded = Buffer.from(data, 'utf8').toString('hex');
  // Ethconnect does not handle empty byte arguments well, so we encode a single null byte
  // when there is no data.
  // See https://github.com/hyperledger/firefly-ethconnect/issues/133
  return encoded === '' ? '0x00' : '0x' + encoded;
}

/**
 * Decode a series of hex bytes into a UTF-8 string
 */
export function decodeHex(data: string) {
  const decoded = Buffer.from(data.replace('0x', ''), 'hex').toString('utf8');
  return decoded === '\x00' ? '' : decoded;
}

export function packSubscriptionName(prefix: string, contractAddress: string, event?: string) {
  if (event === undefined) {
    return [prefix, contractAddress].join(':');
  }
  return [prefix, contractAddress, event].join(':');
}

export function unpackSubscriptionName(prefix: string, data: string) {
  const parts = data.startsWith(prefix + ':')
    ? data.slice(prefix.length + 1).split(':', 2)
    : undefined;
  return {
    prefix,
    poolId: parts?.[0],
    event: parts?.[1],
  };
}

export function packPoolId(poolId: IValidTokenPool) {
  const encodedPoolId = new URLSearchParams({
    [EncodedPoolIdEnum.Address]: poolId.address,
    [EncodedPoolIdEnum.Schema]: poolId.schema,
    [EncodedPoolIdEnum.Type]: poolId.type,
  });
  return encodedPoolId.toString();
}

export function unpackPoolId(data: string): ITokenPool {
  const encodedPoolId = new URLSearchParams(data);
  return {
    address: encodedPoolId.get(EncodedPoolIdEnum.Address),
    schema:
      encodedPoolId.get(EncodedPoolIdEnum.Schema) ?? encodedPoolId.get(EncodedPoolIdEnum.Standard),
    type: encodedPoolId.get(EncodedPoolIdEnum.Type) as TokenType,
  };
}
