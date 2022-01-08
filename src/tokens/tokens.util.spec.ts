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

import {
  decodeHex,
  encodeHex,
  encodeHexIDForURI,
  packSubscriptionName,
  packTokenId,
  unpackSubscriptionName,
  unpackTokenId,
} from './tokens.util';

describe('Util', () => {
  it('encodeHex', () => {
    expect(encodeHex('hello')).toEqual('0x68656c6c6f');
    expect(encodeHex('')).toEqual('0x00');
  });

  it('encodeHexIDForURI', () => {
    expect(encodeHexIDForURI('314592')).toEqual(
      '000000000000000000000000000000000000000000000000000000000004cce0',
    );
  });

  it('decodeHex', () => {
    expect(decodeHex('0x68656c6c6f')).toEqual('hello');
    expect(decodeHex('')).toEqual('');
    expect(decodeHex('0x')).toEqual('');
    expect(decodeHex('0x0')).toEqual('');
    expect(decodeHex('0x00')).toEqual('');
  });

  it('packTokenId', () => {
    expect(packTokenId('F1', '0')).toEqual('340282366920938463463374607431768211456');
  });

  it('unpackTokenId', () => {
    expect(unpackTokenId('340282366920938463463374607431768211456')).toEqual({
      isFungible: true,
      poolId: 'F1',
    });
  });

  it('packSubscriptionName', () => {
    expect(packSubscriptionName('token', 'F1')).toEqual('token:F1');
    expect(packSubscriptionName('token', 'F1', 'create')).toEqual('token:F1:create');
    expect(packSubscriptionName('tok:en', 'F1', 'create')).toEqual('tok:en:F1:create');
  });

  it('unpackSubscriptionName', () => {
    expect(unpackSubscriptionName('token', 'token:F1')).toEqual({
      prefix: 'token',
      poolId: 'F1',
    });
    expect(unpackSubscriptionName('token', 'token:F1:create')).toEqual({
      prefix: 'token',
      poolId: 'F1',
      event: 'create',
    });
    expect(unpackSubscriptionName('tok:en', 'tok:en:F1:create')).toEqual({
      prefix: 'tok:en',
      poolId: 'F1',
      event: 'create',
    });
    expect(unpackSubscriptionName('token', 'bad:F1:create')).toEqual({
      prefix: 'token',
    });
  });
});
