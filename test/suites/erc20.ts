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

import ERC20WithDataABI from '../../src/abi/ERC20WithData.json';
import ERC20NoDataABI from '../../src/abi/ERC20NoData.json';
import {
  CheckInterfaceRequest,
  CheckInterfaceResponse,
  EthConnectAsyncResponse,
  EthConnectMsgRequest,
  EthConnectReturn,
  IAbiMethod,
  InterfaceFormat,
  TokenApproval,
  TokenBurn,
  TokenMint,
  TokenPool,
  TokenPoolEvent,
  TokenTransfer,
  TokenType,
} from '../../src/tokens/tokens.interfaces';
import { FakeObservable, TestContext } from '../app.e2e-context';

const BASE_URL = 'http://eth';
const CONTRACT_ADDRESS = '0x123456';
const IDENTITY = '0x1';
const OPTIONS = {
  headers: {
    'x-firefly-request-id': expect.any(String),
  },
};
const REQUEST = 'request123';
const TX = 'tx123';
const NAME = 'abcTest';
const SYMBOL = 'abc';

const ERC20_NO_DATA_SCHEMA = 'ERC20NoData';
const ERC20_NO_DATA_POOL_ID = `address=${CONTRACT_ADDRESS}&schema=${ERC20_NO_DATA_SCHEMA}&type=${TokenType.FUNGIBLE}`;
const ERC20_WITH_DATA_SCHEMA = 'ERC20WithData';
const ERC20_WITH_DATA_POOL_ID = `address=${CONTRACT_ADDRESS}&schema=${ERC20_WITH_DATA_SCHEMA}&type=${TokenType.FUNGIBLE}`;

const MINT_NO_DATA = 'mint';
const TRANSFER_FROM_NO_DATA = 'transferFrom';
const TRANSFER_NO_DATA = 'transfer';
const BURN_FROM_NO_DATA = 'burnFrom';
const BURN_NO_DATA = 'burn';
const APPROVE_NO_DATA = 'approve';
const MINT_WITH_DATA = 'mintWithData';
const TRANSFER_WITH_DATA = 'transferWithData';
const BURN_WITH_DATA = 'burnWithData';
const APPROVE_WITH_DATA = 'approveWithData';

export default (context: TestContext) => {
  const mockPoolQuery = (withData: boolean | undefined) => {
    if (withData !== undefined) {
      context.http.post.mockReturnValueOnce(
        new FakeObservable(<EthConnectReturn>{
          output: withData,
        }),
      );
    }
    context.http.post
      .mockReturnValueOnce(
        new FakeObservable(<EthConnectReturn>{
          output: NAME,
        }),
      )
      .mockReturnValueOnce(
        new FakeObservable(<EthConnectReturn>{
          output: SYMBOL,
        }),
      )
      .mockReturnValueOnce(
        new FakeObservable(<EthConnectReturn>{
          output: '18',
        }),
      );
  };
  describe('ERC20WithData', () => {
    it('Create pool - unrecognized fields', async () => {
      const request = {
        namespace: 'ns1',
        type: TokenType.FUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS },
        name: NAME,
        symbol: SYMBOL,
        isBestPool: true, // will be stripped but will not cause an error
      };
      const expectedResponse = expect.objectContaining(<TokenPoolEvent>{
        namespace: 'ns1',
        data: `{"tx":${TX}}`,
        poolLocator: `address=${CONTRACT_ADDRESS}&schema=${ERC20_WITH_DATA_SCHEMA}&type=${TokenType.FUNGIBLE}`,
        standard: 'ERC20',
        type: TokenType.FUNGIBLE,
        symbol: SYMBOL,
        decimals: 18,
        info: {
          name: NAME,
          address: CONTRACT_ADDRESS,
          schema: ERC20_WITH_DATA_SCHEMA,
        },
      });
      mockPoolQuery(true);
      context.http.get = jest.fn(() => new FakeObservable(expectedResponse));
      const response = await context.server.post('/createpool').send(request).expect(200);
      expect(response.body).toEqual(expectedResponse);
    });
    it('Create pool - invalid type', async () => {
      const request: TokenPool = {
        namespace: 'ns1',
        type: 'funkible' as TokenType,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS },
        name: NAME,
        symbol: SYMBOL,
      };
      const response = {
        statusCode: 400,
        message: ['type must be one of the following values: fungible, nonfungible'],
        error: 'Bad Request',
      };
      context.http.post = jest.fn(() => new FakeObservable(response));
      await context.server.post('/createpool').send(request).expect(400).expect(response);
    });
    it('Create pool - correct fields', async () => {
      const request: TokenPool = {
        namespace: 'ns1',
        type: TokenType.FUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS },
        name: NAME,
        symbol: SYMBOL,
      };
      const expectedResponse = expect.objectContaining(<TokenPoolEvent>{
        namespace: 'ns1',
        data: `{"tx":${TX}}`,
        poolLocator: `address=${CONTRACT_ADDRESS}&schema=${ERC20_WITH_DATA_SCHEMA}&type=${TokenType.FUNGIBLE}`,
        standard: 'ERC20',
        type: TokenType.FUNGIBLE,
        symbol: SYMBOL,
        decimals: 18,
        info: {
          name: NAME,
          address: CONTRACT_ADDRESS,
          schema: ERC20_WITH_DATA_SCHEMA,
        },
      });
      mockPoolQuery(true);
      context.http.get = jest.fn(() => new FakeObservable(expectedResponse));
      const response = await context.server.post('/createpool').send(request).expect(200);
      expect(response.body).toEqual(expectedResponse);
    });
    it('Mint token', async () => {
      const request: TokenMint = {
        namespace: 'ns1',
        amount: '20',
        signer: IDENTITY,
        poolLocator: ERC20_WITH_DATA_POOL_ID,
        to: '0x123',
      };
      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC20WithDataABI.abi.find(abi => abi.name === MINT_WITH_DATA) as IAbiMethod,
        params: ['0x123', '20', '0x00'],
      };
      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };
      context.http.post = jest.fn(() => new FakeObservable(response));
      await context.server.post('/mint').send(request).expect(202).expect({ id: 'responseId' });
      expect(context.http.post).toHaveBeenCalledTimes(1);
      expect(context.http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });
    it('Transfer token', async () => {
      const request: TokenTransfer = {
        namespace: 'ns1',
        amount: '20',
        signer: IDENTITY,
        poolLocator: ERC20_WITH_DATA_POOL_ID,
        to: '0x123',
        from: IDENTITY,
      };
      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC20WithDataABI.abi.find(abi => abi.name === TRANSFER_WITH_DATA) as IAbiMethod,
        params: [IDENTITY, '0x123', '20', '0x00'],
      };
      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };
      context.http.post = jest.fn(() => new FakeObservable(response));
      await context.server.post('/transfer').send(request).expect(202).expect({ id: 'responseId' });
      expect(context.http.post).toHaveBeenCalledTimes(1);
      expect(context.http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });
    it('Burn token', async () => {
      const request: TokenBurn = {
        namespace: 'ns1',
        amount: '20',
        signer: IDENTITY,
        poolLocator: ERC20_WITH_DATA_POOL_ID,
        from: IDENTITY,
      };
      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC20WithDataABI.abi.find(abi => abi.name === BURN_WITH_DATA) as IAbiMethod,
        params: [IDENTITY, '20', '0x00'],
      };
      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };
      context.http.post = jest.fn(() => new FakeObservable(response));
      await context.server.post('/burn').send(request).expect(202).expect({ id: 'responseId' });
      expect(context.http.post).toHaveBeenCalledTimes(1);
      expect(context.http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });
    it('Token approval', async () => {
      const request: TokenApproval = {
        namespace: 'ns1',
        poolLocator: ERC20_WITH_DATA_POOL_ID,
        signer: IDENTITY,
        operator: '2',
        approved: true,
        config: { allowance: '100' },
      };
      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC20WithDataABI.abi.find(abi => abi.name === APPROVE_WITH_DATA) as IAbiMethod,
        params: ['2', '100', '0x00'],
      };
      const response: EthConnectAsyncResponse = {
        id: '1',
        sent: true,
      };
      context.http.post = jest.fn(() => new FakeObservable(response));
      await context.server.post('/approval').send(request).expect(202).expect({ id: '1' });
      expect(context.http.post).toHaveBeenCalledTimes(1);
      expect(context.http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });
  });
  describe('ERC20NoData', () => {
    it('Create pool - unrecognized fields', async () => {
      const request = {
        namespace: 'ns1',
        type: TokenType.FUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS, withData: false },
        name: NAME,
        symbol: SYMBOL,
        isBestPool: true, // will be stripped but will not cause an error
      };
      const expectedResponse = expect.objectContaining(<TokenPoolEvent>{
        namespace: 'ns1',
        data: `{"tx":${TX}}`,
        poolLocator: `address=${CONTRACT_ADDRESS}&schema=${ERC20_NO_DATA_SCHEMA}&type=${TokenType.FUNGIBLE}`,
        standard: 'ERC20',
        type: TokenType.FUNGIBLE,
        symbol: SYMBOL,
        info: {
          name: NAME,
          address: CONTRACT_ADDRESS,
          schema: ERC20_NO_DATA_SCHEMA,
        },
      });
      mockPoolQuery(false);
      context.http.get = jest.fn(() => new FakeObservable(expectedResponse));
      const response = await context.server.post('/createpool').send(request).expect(200);
      expect(response.body).toEqual(expectedResponse);
    });
    it('Create pool - invalid type', async () => {
      const request: TokenPool = {
        namespace: 'ns1',
        type: 'funkible' as TokenType,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS },
        name: NAME,
        symbol: SYMBOL,
      };
      const response = {
        statusCode: 400,
        message: ['type must be one of the following values: fungible, nonfungible'],
        error: 'Bad Request',
      };
      await context.server.post('/createpool').send(request).expect(400).expect(response);
    });
    it('Create pool - correct fields', async () => {
      const request: TokenPool = {
        namespace: 'ns1',
        type: TokenType.FUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS },
        name: NAME,
        symbol: SYMBOL,
      };
      const expectedResponse = expect.objectContaining(<TokenPoolEvent>{
        namespace: 'ns1',
        data: `{"tx":${TX}}`,
        poolLocator: `address=${CONTRACT_ADDRESS}&schema=${ERC20_NO_DATA_SCHEMA}&type=${TokenType.FUNGIBLE}`,
        standard: 'ERC20',
        type: TokenType.FUNGIBLE,
        symbol: SYMBOL,
        info: {
          name: NAME,
          address: CONTRACT_ADDRESS,
          schema: ERC20_NO_DATA_SCHEMA,
        },
      });
      mockPoolQuery(false);
      context.http.get = jest.fn(() => new FakeObservable(expectedResponse));
      const response = await context.server.post('/createpool').send(request).expect(200);
      expect(response.body).toEqual(expectedResponse);
    });
    it('Mint token', async () => {
      const request: TokenMint = {
        namespace: 'ns1',
        amount: '20',
        signer: IDENTITY,
        poolLocator: ERC20_NO_DATA_POOL_ID,
        to: '0x123',
      };
      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC20NoDataABI.abi.find(abi => abi.name === MINT_NO_DATA) as IAbiMethod,
        params: ['0x123', '20'],
      };
      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };
      context.http.post = jest.fn(() => new FakeObservable(response));
      await context.server.post('/mint').send(request).expect(202).expect({ id: 'responseId' });
      expect(context.http.post).toHaveBeenCalledTimes(1);
      expect(context.http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });
    it('Transfer token', async () => {
      const request: TokenTransfer = {
        namespace: 'ns1',
        amount: '20',
        signer: IDENTITY,
        poolLocator: ERC20_NO_DATA_POOL_ID,
        to: '0x123',
        from: IDENTITY,
      };
      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC20NoDataABI.abi.find(abi => abi.name === TRANSFER_NO_DATA) as IAbiMethod,
        params: ['0x123', '20'],
      };
      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };
      context.http.post = jest.fn(() => new FakeObservable(response));
      await context.server.post('/transfer').send(request).expect(202).expect({ id: 'responseId' });
      expect(context.http.post).toHaveBeenCalledTimes(1);
      expect(context.http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });
    it('Burn token', async () => {
      const request: TokenBurn = {
        namespace: 'ns1',
        amount: '20',
        signer: IDENTITY,
        poolLocator: ERC20_NO_DATA_POOL_ID,
        from: IDENTITY,
      };
      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC20NoDataABI.abi.find(abi => abi.name === BURN_NO_DATA) as IAbiMethod,
        params: ['20'],
      };
      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };
      context.http.post = jest.fn(() => new FakeObservable(response));
      await context.server.post('/burn').send(request).expect(202).expect({ id: 'responseId' });
      expect(context.http.post).toHaveBeenCalledTimes(1);
      expect(context.http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });
    it('Token approval', async () => {
      const request: TokenApproval = {
        namespace: 'ns1',
        poolLocator: ERC20_NO_DATA_POOL_ID,
        signer: IDENTITY,
        operator: '2',
        approved: true,
        config: { allowance: '100' },
      };
      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC20WithDataABI.abi.find(abi => abi.name === APPROVE_NO_DATA) as IAbiMethod,
        params: ['2', '100'],
      };
      const response: EthConnectAsyncResponse = {
        id: '1',
        sent: true,
      };
      context.http.post = jest.fn(() => new FakeObservable(response));
      await context.server.post('/approval').send(request).expect(202).expect({ id: '1' });
      expect(context.http.post).toHaveBeenCalledTimes(1);
      expect(context.http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });
    it('Burn token - custom ABI', async () => {
      const burnMethods = [
        {
          name: 'burn',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [
            {
              internalType: 'uint256',
              name: 'amount',
              type: 'uint256',
            },
          ],
          outputs: [],
        },
        {
          name: 'burnFrom',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [
            {
              internalType: 'address',
              name: 'account',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'amount',
              type: 'uint256',
            },
          ],
          outputs: [],
        },
      ];
      const request: TokenBurn = {
        namespace: 'ns1',
        amount: '20',
        signer: IDENTITY,
        poolLocator: ERC20_NO_DATA_POOL_ID,
        from: IDENTITY,
        interface: {
          format: InterfaceFormat.ABI,
          methods: burnMethods,
        },
      };
      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: burnMethods[0],
        params: ['20'],
      };
      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };
      context.http.post = jest.fn(() => new FakeObservable(response));
      await context.server.post('/burn').send(request).expect(202).expect({ id: 'responseId' });
      expect(context.http.post).toHaveBeenCalledTimes(1);
      expect(context.http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });
    it('Burn token - custom ABI, burn from other', async () => {
      const burnMethods = [
        {
          name: 'burn',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [
            {
              internalType: 'uint256',
              name: 'amount',
              type: 'uint256',
            },
          ],
          outputs: [],
        },
        {
          name: 'burnFrom',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [
            {
              internalType: 'address',
              name: 'account',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'amount',
              type: 'uint256',
            },
          ],
          outputs: [],
        },
      ];
      const request: TokenBurn = {
        namespace: 'ns1',
        amount: '20',
        signer: IDENTITY,
        poolLocator: ERC20_NO_DATA_POOL_ID,
        from: '0x2',
        interface: {
          format: InterfaceFormat.ABI,
          methods: burnMethods,
        },
      };
      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: burnMethods[1],
        params: ['0x2', '20'],
      };
      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };
      context.http.post = jest.fn(() => new FakeObservable(response));
      await context.server.post('/burn').send(request).expect(202).expect({ id: 'responseId' });
      expect(context.http.post).toHaveBeenCalledTimes(1);
      expect(context.http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });
    it('Check interface', async () => {
      const request: CheckInterfaceRequest = {
        poolLocator: ERC20_NO_DATA_POOL_ID,
        format: InterfaceFormat.ABI,
        methods: ERC20NoDataABI.abi,
      };
      const response: CheckInterfaceResponse = {
        approval: {
          format: InterfaceFormat.ABI,
          methods: ERC20NoDataABI.abi.filter(m => m.name === APPROVE_NO_DATA),
        },
        burn: {
          format: InterfaceFormat.ABI,
          methods: ERC20NoDataABI.abi.filter(
            m => m.name === BURN_NO_DATA || m.name === BURN_FROM_NO_DATA,
          ),
        },
        mint: {
          format: InterfaceFormat.ABI,
          methods: ERC20NoDataABI.abi.filter(m => m.name === MINT_NO_DATA),
        },
        transfer: {
          format: InterfaceFormat.ABI,
          methods: [
            ...ERC20NoDataABI.abi.filter(m => m.name === TRANSFER_NO_DATA),
            ...ERC20NoDataABI.abi.filter(m => m.name === TRANSFER_FROM_NO_DATA),
          ],
        },
      };
      await context.server.post('/checkinterface').send(request).expect(200).expect(response);
    });
  });
};
