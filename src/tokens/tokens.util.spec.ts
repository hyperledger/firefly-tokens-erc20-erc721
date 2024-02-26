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

import { IPoolLocator, TokenType } from './tokens.interfaces';
import {
  decodeHex,
  encodeHex,
  packPoolLocator,
  packSubscriptionName,
  unpackPoolLocator,
  unpackSubscriptionName,
} from './tokens.util';

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
    expect(packSubscriptionName('0x123456', 'create', 'ns1')).toEqual('fft:0x123456:create:ns1');
    expect(
      packSubscriptionName(
        'address=0x5bb034ca2fd1ac18e46978a7bbdbe4923e158d83&standard=ERC20WithData&type=fungible',
        'mintWithData',
        'ns1',
      ),
    ).toEqual(
      'fft:address=0x5bb034ca2fd1ac18e46978a7bbdbe4923e158d83&standard=ERC20WithData&type=fungible:mintWithData:ns1',
    );
    expect(packSubscriptionName('0x123', 'create', 'ns1:test')).toEqual(
      'fft:0x123:create:ns1%3Atest',
    );
  });

  it('unpackSubscriptionName', () => {
    expect(unpackSubscriptionName('fft:0x123456:create:ns1')).toEqual({
      poolData: 'ns1',
      poolLocator: '0x123456',
      event: 'create',
    });
    expect(unpackSubscriptionName('token:0x123456:create')).toEqual({
      poolData: undefined,
      poolLocator: '0x123456',
      event: 'create',
    });
    expect(unpackSubscriptionName('token:0x123456')).toEqual({
      poolData: undefined,
      poolLocator: '0x123456',
      event: undefined,
    });
    expect(unpackSubscriptionName('fft:0x123:create:ns1%3Atest')).toEqual({
      poolData: 'ns1:test',
      poolLocator: '0x123',
      event: 'create',
    });
  });

  it('packPoolLocator', () => {
    expect(
      packPoolLocator({
        address: '0x12345',
        schema: 'ERC20WithData',
        type: TokenType.FUNGIBLE,
      }),
    ).toEqual('address=0x12345&schema=ERC20WithData&type=fungible');
  });

  it('unpackPoolLocator', () => {
    expect(unpackPoolLocator('address=0x12345&schema=ERC20WithData&type=fungible')).toEqual(<
      IPoolLocator
    >{
      address: '0x12345',
      schema: 'ERC20WithData',
      type: TokenType.FUNGIBLE,
    });

    expect(unpackPoolLocator('address=0x12345&standard=ERC20WithData&type=fungible')).toEqual(<
      IPoolLocator
    >{
      address: '0x12345',
      schema: 'ERC20WithData',
      type: TokenType.FUNGIBLE,
    });
  });
});
