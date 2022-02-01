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
import { lastValueFrom, Observer } from 'rxjs';
import request from 'superwstest';
import { EventStreamService } from '../src/event-stream/event-stream.service';
import { EventStreamProxyGateway } from '../src/eventstream-proxy/eventstream-proxy.gateway';
import {
  AsyncResponse,
  EthConnectAsyncResponse,
  EthConnectMsgRequest,
  EthConnectReturn,
  TokenBalance,
  TokenBalanceQuery,
  TokenBurn,
  TokenMint,
  TokenPool,
  TokenPoolEvent,
  TokenTransfer,
  TokenType,
} from '../src/tokens/tokens.interfaces';
import { TokensService } from '../src/tokens/tokens.service';
import { AppModule } from './../src/app.module';
import {
  mockBalanceOfABI,
  mockBurnWithDataABI,
  mockMintWithDataABI,
  mockTransferWithDataABI,
} from './constants';

const BASE_URL = 'http://eth';
const CONTRACT_ADDRESS = '0x123456';
const IDENTITY = '0x1';
const INSTANCE_PATH = '/tokens';
const OPTIONS = {
  params: {
    'fly-from': IDENTITY,
    'fly-sync': 'false',
  },
};
const PREFIX = 'fly';
const TOPIC = 'tokentest';
const REQUEST = 'request123';
const TX = 'tx123';
const NAME = 'abcTest';
const SYMBOL = 'abc';
const STANDARD = 'ERC20WithData';
const POOL_ID = `address=${CONTRACT_ADDRESS}&standard=${STANDARD}&type=${TokenType.FUNGIBLE}`;

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

describe('AppController - ERC20 (e2e)', () => {
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

  it('Create pool - unrecognized fields', async () => {
    const request = {
      type: TokenType.FUNGIBLE,
      requestId: REQUEST,
      operator: IDENTITY,
      data: `{"tx":${TX}}`,
      config: { address: CONTRACT_ADDRESS },
      name: NAME,
      symbol: SYMBOL,
      isBestPool: true, // will be stripped but will not cause an error
    };

    const expectedResponse: TokenPoolEvent = expect.objectContaining({
      data: `{"tx":${TX}}`,
      poolId: `address=${CONTRACT_ADDRESS}&standard=${STANDARD}&type=${TokenType.FUNGIBLE}`,
      standard: STANDARD,
      timestamp: expect.any(String),
      type: TokenType.FUNGIBLE,
    });

    http.get = jest.fn(() => new FakeObservable(expectedResponse));

    const response = await server.post('/createpool').send(request).expect(200);
    expect(response.body).toEqual(expectedResponse);
  });

  it('Create new ERC20 contract instance - correct fields', async () => {
    const request: TokenPool = {
      type: TokenType.FUNGIBLE,
      requestId: REQUEST,
      operator: IDENTITY,
      data: `{"tx":${TX}}`,
      config: { address: CONTRACT_ADDRESS },
      name: NAME,
      symbol: SYMBOL,
    };

    const expectedResponse: TokenPoolEvent = expect.objectContaining({
      data: `{"tx":${TX}}`,
      poolId: `address=${CONTRACT_ADDRESS}&standard=${STANDARD}&type=${TokenType.FUNGIBLE}`,
      standard: STANDARD,
      timestamp: expect.any(String),
      type: TokenType.FUNGIBLE,
    });

    http.get = jest.fn(() => new FakeObservable(expectedResponse));

    const response = await server.post('/createpool').send(request).expect(200);
    expect(response.body).toEqual(expectedResponse);
  });

  it('Create new ERC20 contract instance - invalid type', async () => {
    const request: TokenPool = {
      type: 'funkible' as TokenType,
      requestId: REQUEST,
      operator: IDENTITY,
      data: `{"tx":${TX}}`,
      config: { address: CONTRACT_ADDRESS },
      name: NAME,
      symbol: SYMBOL,
    };

    const response = {
      message: 'Type must be fungible or nonfungible',
      statusCode: 404,
    };

    http.post = jest.fn(() => new FakeObservable(response));
    await server.post('/createpool').send(request).expect(404).expect(response);
    expect(http.get).toHaveBeenCalledTimes(0);
  });

  // it('Create new ERC20 contract instance - contract not found on chain', async () => {
  //   const request: TokenPool = {
  //     type: TokenType.FUNGIBLE,
  //     requestId: REQUEST,
  //     operator: IDENTITY,
  //     data: `{"tx":${TX}}`,
  //     config: { address: CONTRACT_ADDRESS },
  //     name: NAME,
  //     symbol: SYMBOL,
  //   };

  //   const response = {
  //     message: 'Contract address not found',
  //     statusCode: 404,
  //   };

  //   // jest.spyOn(http, 'get').mockReturnValue({ status: 404 });
  //   http.get = jest.fn(() => new FakeObservable({ status: 404 }));
  //   http.post = jest.fn(() => new FakeObservable(response));

  //   await server.post('/createpool').send(request).expect(404).expect(response);
  //   expect(http.get).toHaveBeenCalledTimes(1);
  // });

  it('Mint ERC20 token', async () => {
    const request: TokenMint = {
      amount: '2',
      data: 'test',
      operator: IDENTITY,
      poolId: POOL_ID,
      to: '1',
    };
    const response: AsyncResponse = {
      id: '1',
    };

    http.post = jest.fn(() => new FakeObservable(response));

    await server.post('/mint').send(request).expect(202).expect({ id: '1' });

    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith(
      `${BASE_URL}`,
      {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: mockMintWithDataABI,
        params: ['1', '2', 'test'],
      } as EthConnectMsgRequest,
      OPTIONS,
    );
  });

  it('Transfer token', async () => {
    const request: TokenTransfer = {
      amount: '3',
      data: 'test',
      from: '1',
      operator: IDENTITY,
      poolId: POOL_ID,
      to: '2',
    };
    const response: EthConnectAsyncResponse = {
      id: '1',
      sent: true,
    };

    http.post = jest.fn(() => new FakeObservable(response));

    await server.post('/transfer').send(request).expect(202).expect({ id: '1' });

    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith(
      `${BASE_URL}`,
      {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: mockTransferWithDataABI,
        params: ['1', '2', '3', 'test'],
      } as EthConnectMsgRequest,
      OPTIONS,
    );
  });

  it('Burn token', async () => {
    const request: TokenBurn = {
      amount: '2',
      data: 'tx1',
      from: 'A',
      operator: IDENTITY,
      poolId: POOL_ID,
    };
    const response: AsyncResponse = {
      id: '1',
    };

    http.post = jest.fn(() => new FakeObservable(response));

    await server.post('/burn').send(request).expect(202).expect({ id: '1' });

    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith(
      `${BASE_URL}`,
      {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: mockBurnWithDataABI,
        params: ['2', 'tx1'],
      } as EthConnectMsgRequest,
      OPTIONS,
    );
  });

  // it('Query balance', async () => {
  //   const request: TokenBalanceQuery = {
  //     account: '1',
  //     poolId: POOL_ID,
  //   };
  //   const response: EthConnectReturn = {
  //     output: '1',
  //   };

  //   http.get = jest.fn(() => new FakeObservable(response));

  //   await server
  //     .get('/balance')
  //     .query(request)
  //     .expect(200)
  //     .expect(<TokenBalance>{
  //       balance: '1',
  //     });

  //   expect(http.get).toHaveBeenCalledTimes(1);
  //   expect(http.get).toHaveBeenCalledWith(`${BASE_URL}`, {
  //     headers: {
  //       type: 'SendTransaction',
  //     },
  //     from: IDENTITY,
  //     to: CONTRACT_ADDRESS,
  //     method: mockBalanceOfABI,
  //     params: ['1'],
  //   } as EthConnectMsgRequest);
  // });
});
