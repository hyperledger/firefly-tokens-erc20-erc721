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
import { EventStreamService } from '../src/event-stream/event-stream.service';
import { EventStreamProxyGateway } from '../src/eventstream-proxy/eventstream-proxy.gateway';
import {
  AsyncResponse,
  EthConnectAsyncResponse,
  EthConnectReturn,
  TokenBalance,
  TokenBalanceQuery,
  TokenBurn,
  TokenMint,
  TokenPool,
  TokenTransfer,
  TokenType,
} from '../src/tokens/tokens.interfaces';
import { TokensService } from '../src/tokens/tokens.service';
import { AppModule } from './../src/app.module';

const BASE_URL = 'http://eth';
const CONTRACT_URI = '/abis/123';
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

describe('AppController (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<typeof request>;
  let http: {
    get: ReturnType<typeof jest.fn>;
    post: ReturnType<typeof jest.fn>;
  };

  const eventstream = {
    getSubscription: jest.fn(),
  };

  beforeEach(async () => {
    http = {
      get: jest.fn(),
      post: jest.fn(),
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
    app.get(TokensService).configure(BASE_URL, INSTANCE_PATH, TOPIC, PREFIX, CONTRACT_URI, '', '');

    (app.getHttpServer() as Server).listen();
    server = request(app.getHttpServer());
  });

  afterEach(async () => {
    await app.close();
  });

  it('Create pool - unrecognized fields', async () => {
    const request = {
      type: TokenType.FUNGIBLE,
      operator: IDENTITY,
      name: 'name',
      symbol: 'symbol',
      isBestPool: true, // will be stripped but will not cause an error
    };
    const response: EthConnectAsyncResponse = {
      id: 'op1',
      sent: true,
    };

    http.post = jest.fn(() => new FakeObservable(response));

    await server.post('/createpool').send(request).expect(202).expect({ id: 'op1' });
  });

  it('Create new ERC20 contract instance', async () => {
    const request: TokenPool = {
      data: 'tx1',
      name: 'testName',
      operator: IDENTITY,
      requestId: 'op1',
      symbol: 'testSymbol',
    };
    const response: EthConnectAsyncResponse = {
      id: 'op1',
      sent: true,
    };

    http.post = jest.fn(() => new FakeObservable(response));
    await server.post('/createpool').send(request).expect(202).expect({ id: 'op1' });

    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith(
      `${BASE_URL}${INSTANCE_PATH}/create`,
      {
        data: '0x747831',
        name: 'testName',
        symbol: 'testSymbol',
      },
      {
        ...OPTIONS,
        params: {
          ...OPTIONS.params,
          'fly-id': 'op1',
        },
      },
    );
  });

  it('Create new ERC20 contract instance - valid type', async () => {
    const request: TokenPool = {
      data: 'tx1',
      name: 'testName',
      operator: IDENTITY,
      requestId: 'op1',
      symbol: 'testSymbol',
      type: TokenType.FUNGIBLE,
    };
    const response: EthConnectAsyncResponse = {
      id: 'op1',
      sent: true,
    };

    http.post = jest.fn(() => new FakeObservable(response));
    await server.post('/createpool').send(request).expect(202).expect({ id: 'op1' });

    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith(
      `${BASE_URL}${INSTANCE_PATH}/create`,
      {
        data: '0x747831',
        name: 'testName',
        symbol: 'testSymbol',
      },
      {
        ...OPTIONS,
        params: {
          ...OPTIONS.params,
          'fly-id': 'op1',
        },
      },
    );
  });

  it('Create new ERC20 contract instance - invalid type', async () => {
    const request: TokenPool = {
      data: 'tx1',
      name: 'testName',
      operator: IDENTITY,
      requestId: 'op1',
      symbol: 'testSymbol',
      type: 'nonfungible',
    };
    const response: EthConnectAsyncResponse = {
      id: 'op1',
      sent: true,
    };

    http.post = jest.fn(() => new FakeObservable(response));
    await server.post('/createpool').send(request).expect(202).expect({ id: 'op1' });

    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith(
      `${BASE_URL}${INSTANCE_PATH}/create`,
      {
        data: '0x747831',
        name: 'testName',
        symbol: 'testSymbol',
      },
      {
        ...OPTIONS,
        params: {
          ...OPTIONS.params,
          'fly-id': 'op1',
        },
      },
    );
  });

  it('Mint ERC20 token', async () => {
    const request: TokenMint = {
      amount: '2',
      data: 'test',
      operator: IDENTITY,
      poolId: CONTRACT_ADDRESS,
      to: '1',
    };
    const response: AsyncResponse = {
      id: '1',
    };

    http.post = jest.fn(() => new FakeObservable(response));

    await server.post('/mint').send(request).expect(202).expect({ id: '1' });

    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith(
      `${BASE_URL}${CONTRACT_URI}/${CONTRACT_ADDRESS}/mintWithData`,
      {
        amount: '2',
        data: '0x74657374',
        to: '1',
      },
      OPTIONS,
    );
  });

  it('Transfer token', async () => {
    const request: TokenTransfer = {
      amount: '2',
      from: '1',
      operator: IDENTITY,
      poolId: CONTRACT_ADDRESS,
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
      `${BASE_URL}${CONTRACT_URI}/${CONTRACT_ADDRESS}/transferWithData`,
      {
        amount: '2',
        data: '0x00',
        from: '1',
        to: '2',
      },
      OPTIONS,
    );
  });

  it('Burn token', async () => {
    const request: TokenBurn = {
      amount: '2',
      data: 'tx1',
      from: 'A',
      operator: IDENTITY,
      poolId: CONTRACT_ADDRESS,
    };
    const response: AsyncResponse = {
      id: '1',
    };

    http.post = jest.fn(() => new FakeObservable(response));

    await server.post('/burn').send(request).expect(202).expect({ id: '1' });

    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith(
      `${BASE_URL}${CONTRACT_URI}/${CONTRACT_ADDRESS}/burnWithData`,
      {
        data: '0x747831',
        from: 'A',
        amount: '2',
      },
      OPTIONS,
    );
  });

  it('Query balance', async () => {
    const request: TokenBalanceQuery = {
      account: '1',
      poolId: CONTRACT_ADDRESS,
    };
    const response: EthConnectReturn = {
      output: '1',
    };

    http.get = jest.fn(() => new FakeObservable(response));

    await server
      .get('/balance')
      .query(request)
      .expect(200)
      .expect(<TokenBalance>{
        balance: '1',
      });

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.get).toHaveBeenCalledWith(
      `${BASE_URL}${CONTRACT_URI}/${CONTRACT_ADDRESS}/balanceOf`,
      {
        params: {
          account: '1',
        },
      },
    );
  });
});
