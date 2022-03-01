// Copyright © 2021 Kaleido, Inc.
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

import { Server } from 'http';
import { HttpService } from '@nestjs/axios';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test, TestingModule } from '@nestjs/testing';
import { AxiosResponse } from 'axios';
import { Observer } from 'rxjs';
import request from 'superwstest';
import ERC721NoDataABI from '../solidity/build/contracts/ERC721NoData.json';
import ERC721WithDataABI from '../solidity/build/contracts/ERC721WithData.json';
import { EventStreamService } from '../src/event-stream/event-stream.service';
import { EventStreamProxyGateway } from '../src/eventstream-proxy/eventstream-proxy.gateway';
import {
  EthConnectAsyncResponse,
  EthConnectMsgRequest,
  IAbiMethod,
  TokenBurn,
  TokenMint,
  TokenPool,
  TokenPoolEvent,
  TokenTransfer,
  TokenType,
} from '../src/tokens/tokens.interfaces';
import { TokensService } from '../src/tokens/tokens.service';
import { AppModule } from './../src/app.module';

const BASE_URL = 'http://eth';
const CONTRACT_ADDRESS = '0x123456';
const IDENTITY = '0x1';
const OPTIONS = {
  params: {
    'fly-from': IDENTITY,
    'fly-id': undefined,
    'fly-sync': 'false',
  },
};
const PREFIX = 'fly';
const TOPIC = 'tokentest';
const REQUEST = 'request123';
const TX = 'tx123';
const NAME = 'abcTest';
const SYMBOL = 'abc';
const ERC721_NO_DATA_STANDARD = 'ERC721NoData';
const ERC721_NO_DATA_POOL_ID = `address=${CONTRACT_ADDRESS}&standard=${ERC721_NO_DATA_STANDARD}&type=${TokenType.NONFUNGIBLE}`;
const ERC721_WITH_DATA_STANDARD = 'ERC721WithData';
const ERC721_WITH_DATA_POOL_ID = `address=${CONTRACT_ADDRESS}&standard=${ERC721_WITH_DATA_STANDARD}&type=${TokenType.NONFUNGIBLE}`;

const MINT_NO_DATA = 'mintNoData';
const TRANSFER_NO_DATA = 'transferNoData';
const BURN_NO_DATA = 'burnNoData';
const MINT_WITH_DATA = 'mintWithData';
const TRANSFER_WITH_DATA = 'transferWithData';
const BURN_WITH_DATA = 'burnWithData';

const standardAbiMap = {
  ERC721NoData: ERC721NoDataABI.abi as IAbiMethod[],
  ERC721WithData: ERC721WithDataABI.abi as IAbiMethod[],
};

class FakeObservable<T> {
  constructor(public data: T) {}

  subscribe(observer?: Partial<Observer<AxiosResponse<T>>>) {
    observer?.next &&
      observer?.next({
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
        data: this.data,
      });
    observer?.complete && observer?.complete();
  }
}

describe('ERC721 - e2e', () => {
  let app: INestApplication;
  let server: ReturnType<typeof request>;
  let http: {
    get: ReturnType<typeof jest.fn>;
    post: ReturnType<typeof jest.fn>;
    subscribe: ReturnType<typeof jest.fn>;
  };

  const eventstream = {
    getSubscription: jest.fn(),
  };

  beforeEach(async () => {
    http = {
      get: jest.fn(),
      post: jest.fn(),
      subscribe: jest.fn(),
    };
    eventstream.getSubscription.mockReset();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(HttpService)
      .useValue(http)
      .overrideProvider(EventStreamService)
      .useValue(eventstream)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    app.get(EventStreamProxyGateway).configure('url', TOPIC);
    app.get(TokensService).configure(BASE_URL, TOPIC, PREFIX, '', '');

    (app.getHttpServer() as Server).listen();
    server = request(app.getHttpServer());
  });

  afterEach(async () => {
    await app.close();
  });

  describe('ERC721WithData', () => {
    it('Create ERC721WithData pool - correct fields', async () => {
      const request: TokenPool = {
        type: TokenType.NONFUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS },
        name: NAME,
        symbol: SYMBOL,
      };

      const expectedResponse: TokenPoolEvent = expect.objectContaining({
        data: `{"tx":${TX}}`,
        poolId: `address=${CONTRACT_ADDRESS}&standard=${ERC721_WITH_DATA_STANDARD}&type=${TokenType.NONFUNGIBLE}`,
        standard: ERC721_WITH_DATA_STANDARD,
        timestamp: expect.any(String),
        type: TokenType.NONFUNGIBLE,
      });

      http.get = jest.fn(() => new FakeObservable(expectedResponse));

      const response = await server.post('/createpool').send(request).expect(200);
      expect(response.body).toEqual(expectedResponse);
    });

    it('Create ERC721WithData pool - correct fields - explicit standard', async () => {
      const request: TokenPool = {
        type: TokenType.NONFUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS, withData: true },
        name: NAME,
        symbol: SYMBOL,
      };

      const expectedResponse: TokenPoolEvent = expect.objectContaining({
        data: `{"tx":${TX}}`,
        poolId: `address=${CONTRACT_ADDRESS}&standard=${ERC721_WITH_DATA_STANDARD}&type=${TokenType.NONFUNGIBLE}`,
        standard: ERC721_WITH_DATA_STANDARD,
        timestamp: expect.any(String),
        type: TokenType.NONFUNGIBLE,
      });

      http.get = jest.fn(() => new FakeObservable(expectedResponse));

      const response = await server.post('/createpool').send(request).expect(200);
      expect(response.body).toEqual(expectedResponse);
    });

    it('Mint ERC721WithData token', async () => {
      const request: TokenMint = {
        tokenIndex: '721',
        signer: IDENTITY,
        poolId: ERC721_WITH_DATA_POOL_ID,
        to: '0x123',
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: standardAbiMap.ERC721WithData.find(
          abi => abi.name === MINT_WITH_DATA,
        ) as IAbiMethod,
        params: ['0x123', '721', '0x00'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));

      await server.post('/mint').send(request).expect(202).expect({ id: 'responseId' });

      expect(http.post).toHaveBeenCalledTimes(1);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });

    it('Transfer ERC721WithData token', async () => {
      const request: TokenTransfer = {
        tokenIndex: '721',
        signer: IDENTITY,
        poolId: ERC721_WITH_DATA_POOL_ID,
        to: '0x123',
        from: IDENTITY,
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: standardAbiMap.ERC721WithData.find(
          abi => abi.name === TRANSFER_WITH_DATA,
        ) as IAbiMethod,
        params: [IDENTITY, '0x123', '721', '0x00'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));

      await server.post('/transfer').send(request).expect(202).expect({ id: 'responseId' });

      expect(http.post).toHaveBeenCalledTimes(1);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });

    it('Burn ERC721NoData token', async () => {
      const request: TokenBurn = {
        tokenIndex: '721',
        signer: IDENTITY,
        poolId: ERC721_WITH_DATA_POOL_ID,
        from: IDENTITY,
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: standardAbiMap.ERC721WithData.find(
          abi => abi.name === BURN_WITH_DATA,
        ) as IAbiMethod,
        params: [IDENTITY, '721', '0x00'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));

      await server.post('/burn').send(request).expect(202).expect({ id: 'responseId' });

      expect(http.post).toHaveBeenCalledTimes(1);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });
  });

  describe('ERC721NoData', () => {
    it('Create ERC721NoData pool - correct fields', async () => {
      const request: TokenPool = {
        type: TokenType.NONFUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS, withData: false },
        name: NAME,
        symbol: SYMBOL,
      };

      const expectedResponse: TokenPoolEvent = expect.objectContaining({
        data: `{"tx":${TX}}`,
        poolId: `address=${CONTRACT_ADDRESS}&standard=${ERC721_NO_DATA_STANDARD}&type=${TokenType.NONFUNGIBLE}`,
        standard: ERC721_NO_DATA_STANDARD,
        timestamp: expect.any(String),
        type: TokenType.NONFUNGIBLE,
      });

      http.get = jest.fn(() => new FakeObservable(expectedResponse));

      const response = await server.post('/createpool').send(request).expect(200);
      expect(response.body).toEqual(expectedResponse);
    });

    it('Mint ERC721NoData token', async () => {
      const request: TokenMint = {
        tokenIndex: '721',
        signer: IDENTITY,
        poolId: ERC721_NO_DATA_POOL_ID,
        to: '0x123',
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: standardAbiMap.ERC721NoData.find(abi => abi.name === MINT_NO_DATA) as IAbiMethod,
        params: ['0x123', '721'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));

      await server.post('/mint').send(request).expect(202).expect({ id: 'responseId' });

      expect(http.post).toHaveBeenCalledTimes(1);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });

    it('Transfer ERC721NoData token', async () => {
      const request: TokenTransfer = {
        tokenIndex: '721',
        signer: IDENTITY,
        poolId: ERC721_NO_DATA_POOL_ID,
        to: '0x123',
        from: IDENTITY,
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: standardAbiMap.ERC721NoData.find(
          abi => abi.name === TRANSFER_NO_DATA,
        ) as IAbiMethod,
        params: [IDENTITY, '0x123', '721'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));

      await server.post('/transfer').send(request).expect(202).expect({ id: 'responseId' });

      expect(http.post).toHaveBeenCalledTimes(1);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });

    it('Burn ERC721NoData token', async () => {
      const request: TokenBurn = {
        tokenIndex: '721',
        signer: IDENTITY,
        poolId: ERC721_NO_DATA_POOL_ID,
        from: IDENTITY,
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: standardAbiMap.ERC721NoData.find(abi => abi.name === BURN_NO_DATA) as IAbiMethod,
        params: [IDENTITY, '721'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));

      await server.post('/burn').send(request).expect(202).expect({ id: 'responseId' });

      expect(http.post).toHaveBeenCalledTimes(1);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });
  });
});
