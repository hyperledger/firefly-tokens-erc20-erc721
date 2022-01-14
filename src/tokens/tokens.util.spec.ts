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

import { decodeHex, encodeHex, packSubscriptionName, unpackSubscriptionName } from './tokens.util';

describe('Util', () => {
  it('encodeHex', () => {
    expect(encodeHex('hello')).toEqual('0x68656c6c6f');
    expect(encodeHex('')).toEqual('0x00');
  });

  it('decodeHex', () => {
    expect(decodeHex('0x68656c6c6f')).toEqual('hello');
    expect(decodeHex('')).toEqual('');
    expect(decodeHex('0x')).toEqual('');
    expect(decodeHex('0x0')).toEqual('');
    expect(decodeHex('0x00')).toEqual('');
  });

  it('packSubscriptionName', () => {
    expect(packSubscriptionName('token', '0x123456')).toEqual('token:0x123456');
    expect(packSubscriptionName('token', '0x123456', 'create')).toEqual('token:0x123456:create');
    expect(packSubscriptionName('tok:en', '0x123456', 'create')).toEqual('tok:en:0x123456:create');
  });

  it('unpackSubscriptionName', () => {
    expect(unpackSubscriptionName('token', 'token:0x123456')).toEqual({
      prefix: 'token',
      poolId: '0x123456',
    });
    expect(unpackSubscriptionName('token', 'token:0x123456:create')).toEqual({
      prefix: 'token',
      poolId: '0x123456',
      event: 'create',
    });
    expect(unpackSubscriptionName('tok:en', 'tok:en:0x123456:create')).toEqual({
      prefix: 'tok:en',
      poolId: '0x123456',
      event: 'create',
    });
  });
});
