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
  EncodedPoolLocatorEnum,
  IPoolLocator,
  IValidPoolLocator,
  TokenType,
} from './tokens.interfaces';

const SUBSCRIPTION_PREFIX = 'fft';

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

export function packSubscriptionName(poolLocator: string, event: string, poolData?: string) {
  if (poolData !== undefined) {
    return [SUBSCRIPTION_PREFIX, poolLocator, event, encodeURIComponent(poolData)].join(':');
  }
  return [SUBSCRIPTION_PREFIX, poolLocator, event].join(':');
}

export function unpackSubscriptionName(data: string) {
  const parts = data.split(':');
  if (parts.length === 4 && parts[0] === SUBSCRIPTION_PREFIX) {
    return {
      poolLocator: parts[1],
      event: parts[2],
      poolData: decodeURIComponent(parts[3]),
    };
  } else if (parts.length === 3) {
    return {
      poolLocator: parts[1],
      event: parts[2],
      poolData: undefined,
    };
  } else if (parts.length === 2) {
    return {
      poolLocator: parts[1],
      event: undefined,
      poolData: undefined,
    };
  } else {
    return {};
  }
}

/**
 * Given a pool locator object, create a packed string representation.
 *
 * This should only be called once when the pool is first created! You should
 * never re-pack a locator during event or request processing (always send
 * back the one provided as input or unpacked from the subscription).
 */
export function packPoolLocator(locator: IValidPoolLocator) {
  const encoded = new URLSearchParams({
    [EncodedPoolLocatorEnum.Address]: locator.address,
    [EncodedPoolLocatorEnum.Schema]: locator.schema,
    [EncodedPoolLocatorEnum.Type]: locator.type,
  });
  return encoded.toString();
}

/**
 * Unpack a pool locator string into its meaningful parts.
 */
export function unpackPoolLocator(data: string): IPoolLocator {
  const encoded = new URLSearchParams(data);
  return {
    address: encoded.get(EncodedPoolLocatorEnum.Address),
    schema:
      encoded.get(EncodedPoolLocatorEnum.Schema) ?? encoded.get(EncodedPoolLocatorEnum.Standard),
    type: encoded.get(EncodedPoolLocatorEnum.Type) as TokenType,
  };
}

export function validatePoolLocator(poolLocator: IPoolLocator): poolLocator is IValidPoolLocator {
  return poolLocator.address !== null && poolLocator.schema !== null && poolLocator.type !== null;
}
