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
  EthConnectAsyncResponse,
  EthConnectReturn,
  TokenBalance,
  TokenBalanceQuery,
  TokenBurn, TokenMint, TokenPool, TokenTransfer
} from '../src/tokens/tokens.interfaces';
import { TokensService } from '../src/tokens/tokens.service';
import { AppModule } from './../src/app.module';

const BASE_URL = 'http://eth';
const INSTANCE_PATH = '/tokens';
const F1_POOL_ID = 'F1';
const FUNG_TYPE_ID = '340282366920938463463374607431768211456';
const IDENTITY = '0x1';
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
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    app.get(EventStreamProxyGateway).configure('url', TOPIC);
    app.get(TokensService).configure(BASE_URL, INSTANCE_PATH, TOPIC, PREFIX, '', '');

    (app.getHttpServer() as Server).listen();
    server = request(app.getHttpServer());
  });

  afterEach(async () => {
    await app.close();
  });

  it('Create fungible pool', async () => {
    const request: TokenPool = {
      requestId: 'op1',
      data: 'tx1',
      operator: IDENTITY,
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
        is_fungible: true,
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

  it('Mint fungible token', async () => {
    const request: TokenMint = {
      poolId: F1_POOL_ID,
      to: '1',
      amount: '2',
      data: 'test',
      operator: IDENTITY,
    };
    const response: EthConnectAsyncResponse = {
      id: '1',
      sent: true,
    };

    http.post = jest.fn(() => new FakeObservable(response));

    await server.post('/mint').send(request).expect(202).expect({ id: '1' });

    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith(
      `${BASE_URL}${INSTANCE_PATH}/mintFungible`,
      {
        type_id: FUNG_TYPE_ID,
        to: ['1'],
        amounts: ['2'],
        data: '0x74657374',
      },
      OPTIONS,
    );
  });

  it('Burn token', async () => {
    const request: TokenBurn = {
      poolId: 'F1',
      tokenIndex: '1',
      from: 'A',
      amount: '1',
      data: 'tx1',
      operator: IDENTITY,
    };
    const response: EthConnectAsyncResponse = {
      id: '1',
      sent: true,
    };

    http.post = jest.fn(() => new FakeObservable(response));

    await server.post('/burn').send(request).expect(202).expect({ id: '1' });

    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith(
      `${BASE_URL}${INSTANCE_PATH}/burn`,
      {
        id: '340282366920938463463374607431768211457',
        from: 'A',
        amount: '1',
        data: '0x747831',
      },
      OPTIONS,
    );
  });

  it('Transfer token', async () => {
    const request: TokenTransfer = {
      poolId: F1_POOL_ID,
      from: '1',
      to: '2',
      amount: '2',
      operator: IDENTITY,
    };
    const response: EthConnectAsyncResponse = {
      id: '1',
      sent: true,
    };

    http.post = jest.fn(() => new FakeObservable(response));

    await server.post('/transfer').send(request).expect(202).expect({ id: '1' });

    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith(
      `${BASE_URL}${INSTANCE_PATH}/safeTransferFrom`,
      {
        id: FUNG_TYPE_ID,
        from: '1',
        to: '2',
        amount: '2',
        data: '0x00',
      },
      OPTIONS,
    );
  });

  it('Query balance', async () => {
    const request: TokenBalanceQuery = {
      account: '1',
      poolId: F1_POOL_ID,
      tokenIndex: '0',
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
    expect(http.get).toHaveBeenCalledWith(`${BASE_URL}${INSTANCE_PATH}/balanceOf`, {
      params: {
        account: '1',
        id: FUNG_TYPE_ID,
      },
    });
  });
});
