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

import ERC721NoDataABI from '../../src/abi/ERC721NoData.json';
import ERC721WithDataV2ABI from '../../src/abi/ERC721WithDataV2.json';
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
const ERC721_NO_DATA_SCHEMA = 'ERC721NoData';
const ERC721_NO_DATA_POOL_ID = `address=${CONTRACT_ADDRESS}&schema=${ERC721_NO_DATA_SCHEMA}&type=${TokenType.NONFUNGIBLE}`;
const ERC721_WITH_DATA_SCHEMA = 'ERC721WithDataV2';
const ERC721_WITH_DATA_POOL_ID = `address=${CONTRACT_ADDRESS}&schema=${ERC721_WITH_DATA_SCHEMA}&type=${TokenType.NONFUNGIBLE}`;

const MINT_NO_DATA = 'safeMint';
const TRANSFER_NO_DATA = 'safeTransferFrom';
const BURN_NO_DATA = 'burn';
const APPROVE_NO_DATA = 'approve';
const APPROVE_FOR_ALL_NO_DATA = 'setApprovalForAll';
const MINT_WITH_URI = 'mintWithURI';
const TRANSFER_WITH_DATA = 'transferWithData';
const BURN_WITH_DATA = 'burnWithData';
const APPROVE_WITH_DATA = 'approveWithData';
const APPROVE_FOR_ALL_WITH_DATA = 'setApprovalForAllWithData';

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
      );
  };
  const mockURIQuery = (withURI: boolean) => {
    context.http.post.mockReturnValueOnce(
      new FakeObservable(<EthConnectReturn>{
        output: withURI,
      }),
    );
  };
  describe('ERC721WithData', () => {
    it('Create pool - correct fields', async () => {
      const request: TokenPool = {
        namespace: 'ns1',
        type: TokenType.NONFUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS },
        name: NAME,
        symbol: SYMBOL,
      };
      const expectedResponse = expect.objectContaining(<TokenPoolEvent>{
        data: `{"tx":${TX}}`,
        poolLocator: `address=${CONTRACT_ADDRESS}&schema=${ERC721_WITH_DATA_SCHEMA}&type=${TokenType.NONFUNGIBLE}`,
        standard: 'ERC721',
        type: TokenType.NONFUNGIBLE,
        symbol: SYMBOL,
        info: {
          name: NAME,
          address: CONTRACT_ADDRESS,
          schema: ERC721_WITH_DATA_SCHEMA,
        },
      });
      mockURIQuery(true);
      mockPoolQuery(undefined);
      context.http.get = jest.fn(() => new FakeObservable(expectedResponse));
      const response = await context.server.post('/createpool').send(request).expect(200);
      expect(response.body).toEqual(expectedResponse);
    });
    it('Create pool - base URI', async () => {
      const request: TokenPool = {
        namespace: 'ns1',
        type: TokenType.NONFUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS, uri: 'http://test-uri/' },
        name: NAME,
        symbol: SYMBOL,
      };
      const expectedResponse = expect.objectContaining(<TokenPoolEvent>{
        data: `{"tx":${TX}}`,
        poolLocator: `address=${CONTRACT_ADDRESS}&schema=${ERC721_WITH_DATA_SCHEMA}&type=${TokenType.NONFUNGIBLE}`,
        standard: 'ERC721',
        type: TokenType.NONFUNGIBLE,
        symbol: SYMBOL,
        info: {
          name: NAME,
          address: CONTRACT_ADDRESS,
          schema: ERC721_WITH_DATA_SCHEMA,
        },
      });
      mockURIQuery(true);
      mockPoolQuery(undefined);
      context.http.get = jest.fn(() => new FakeObservable(expectedResponse));
      const response = await context.server.post('/createpool').send(request).expect(200);
      expect(response.body).toEqual(expectedResponse);
    });
    it('Mint token', async () => {
      const request: TokenMint = {
        namespace: 'ns1',
        signer: IDENTITY,
        poolLocator: ERC721_WITH_DATA_POOL_ID,
        to: '0x123',
      };
      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC721WithDataV2ABI.abi.find(abi => abi.name === MINT_WITH_URI) as IAbiMethod,
        params: ['0x123', '0x00', ''],
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
        tokenIndex: '721',
        signer: IDENTITY,
        poolLocator: ERC721_WITH_DATA_POOL_ID,
        to: '0x123',
        from: IDENTITY,
      };
      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC721WithDataV2ABI.abi.find(abi => abi.name === TRANSFER_WITH_DATA) as IAbiMethod,
        params: [IDENTITY, '0x123', '721', '0x00'],
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
        tokenIndex: '721',
        signer: IDENTITY,
        poolLocator: ERC721_WITH_DATA_POOL_ID,
        from: IDENTITY,
      };
      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC721WithDataV2ABI.abi.find(abi => abi.name === BURN_WITH_DATA) as IAbiMethod,
        params: [IDENTITY, '721', '0x00'],
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
    it('Token approval for all', async () => {
      const request: TokenApproval = {
        namespace: 'ns1',
        poolLocator: ERC721_WITH_DATA_POOL_ID,
        signer: IDENTITY,
        operator: '2',
        approved: true,
        config: {},
      };
      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC721WithDataV2ABI.abi.find(
          abi => abi.name === APPROVE_FOR_ALL_WITH_DATA,
        ) as IAbiMethod,
        params: ['2', true, '0x00'],
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
    it('Token approval for one', async () => {
      const request: TokenApproval = {
        namespace: 'ns1',
        poolLocator: ERC721_WITH_DATA_POOL_ID,
        signer: IDENTITY,
        operator: '2',
        approved: true,
        config: { tokenIndex: '5' },
      };
      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC721WithDataV2ABI.abi.find(abi => abi.name === APPROVE_WITH_DATA) as IAbiMethod,
        params: ['2', '5', '0x00'],
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
  describe('ERC721NoData', () => {
    it('Create pool - correct fields', async () => {
      const request: TokenPool = {
        namespace: 'ns1',
        type: TokenType.NONFUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS },
        name: NAME,
        symbol: SYMBOL,
      };
      const expectedResponse = expect.objectContaining(<TokenPoolEvent>{
        data: `{"tx":${TX}}`,
        poolLocator: `address=${CONTRACT_ADDRESS}&schema=${ERC721_NO_DATA_SCHEMA}&type=${TokenType.NONFUNGIBLE}`,
        standard: 'ERC721',
        type: TokenType.NONFUNGIBLE,
        symbol: SYMBOL,
        info: {
          name: NAME,
          address: CONTRACT_ADDRESS,
          schema: ERC721_NO_DATA_SCHEMA,
        },
      });
      mockURIQuery(false);
      mockURIQuery(false);
      mockPoolQuery(false);
      context.http.get = jest.fn(() => new FakeObservable(expectedResponse));
      const response = await context.server.post('/createpool').send(request).expect(200);
      expect(response.body).toEqual(expectedResponse);
    });
    it('Mint token', async () => {
      const request: TokenMint = {
        namespace: 'ns1',
        signer: IDENTITY,
        poolLocator: ERC721_NO_DATA_POOL_ID,
        to: '0x123',
      };
      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC721NoDataABI.abi.find(abi => abi.name === MINT_NO_DATA) as IAbiMethod,
        params: ['0x123'],
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
        tokenIndex: '721',
        signer: IDENTITY,
        poolLocator: ERC721_NO_DATA_POOL_ID,
        to: '0x123',
        from: IDENTITY,
      };
      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC721NoDataABI.abi.find(
          abi => abi.name === TRANSFER_NO_DATA && abi.inputs?.length === 4,
        ) as IAbiMethod,
        params: [IDENTITY, '0x123', '721', '0x00'],
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
        tokenIndex: '721',
        signer: IDENTITY,
        poolLocator: ERC721_NO_DATA_POOL_ID,
        from: IDENTITY,
      };
      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC721NoDataABI.abi.find(abi => abi.name === BURN_NO_DATA) as IAbiMethod,
        params: ['721'],
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
    it('Token approval for all', async () => {
      const request: TokenApproval = {
        namespace: 'ns1',
        poolLocator: ERC721_NO_DATA_POOL_ID,
        signer: IDENTITY,
        operator: '2',
        approved: true,
        config: {},
      };
      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC721NoDataABI.abi.find(abi => abi.name === APPROVE_FOR_ALL_NO_DATA) as IAbiMethod,
        params: ['2', true],
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
    it('Token approval for one', async () => {
      const request: TokenApproval = {
        namespace: 'ns1',
        poolLocator: ERC721_NO_DATA_POOL_ID,
        signer: IDENTITY,
        operator: '2',
        approved: true,
        config: { tokenIndex: '5' },
      };
      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC721NoDataABI.abi.find(abi => abi.name === APPROVE_NO_DATA) as IAbiMethod,
        params: ['2', '5'],
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
    it('Mint token - custom ABI', async () => {
      const safeMintAutoIndex = {
        name: 'safeMint',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
          {
            internalType: 'address',
            name: 'to',
            type: 'address',
          },
        ],
        outputs: [],
      };
      const request: TokenMint = {
        namespace: 'ns1',
        signer: IDENTITY,
        poolLocator: ERC721_NO_DATA_POOL_ID,
        to: '0x123',
        interface: {
          format: InterfaceFormat.ABI,
          methods: [safeMintAutoIndex],
        },
      };
      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: safeMintAutoIndex,
        params: ['0x123'],
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
    it('Check interface', async () => {
      const request: CheckInterfaceRequest = {
        poolLocator: ERC721_NO_DATA_POOL_ID,
        format: InterfaceFormat.ABI,
        methods: ERC721NoDataABI.abi,
      };
      const response: CheckInterfaceResponse = {
        approval: {
          format: InterfaceFormat.ABI,
          methods: [
            ...ERC721NoDataABI.abi.filter(m => m.name === APPROVE_NO_DATA),
            ...ERC721NoDataABI.abi.filter(m => m.name === APPROVE_FOR_ALL_NO_DATA),
          ],
        },
        burn: {
          format: InterfaceFormat.ABI,
          methods: ERC721NoDataABI.abi.filter(m => m.name === BURN_NO_DATA),
        },
        mint: {
          format: InterfaceFormat.ABI,
          methods: ERC721NoDataABI.abi.filter(m => m.name === MINT_NO_DATA),
        },
        transfer: {
          format: InterfaceFormat.ABI,
          methods: [
            ...ERC721NoDataABI.abi.filter(
              m => m.name === TRANSFER_NO_DATA && m.inputs.length === 4,
            ),
            ...ERC721NoDataABI.abi.filter(
              m => m.name === TRANSFER_NO_DATA && m.inputs.length === 3,
            ),
          ],
        },
      };
      await context.server.post('/checkinterface').send(request).expect(200).expect(response);
    });
  });
};
