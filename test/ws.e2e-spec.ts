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
import { AppModule } from '../src/app.module';
import {
    Event,
    EventStreamReply,
    EventStreamSubscription
} from '../src/event-stream/event-stream.interfaces';
import { EventStreamService } from '../src/event-stream/event-stream.service';
import { EventStreamProxyGateway } from '../src/eventstream-proxy/eventstream-proxy.gateway';
import { ReceiptEvent } from '../src/eventstream-proxy/eventstream-proxy.interfaces';
import {
    EthConnectReturn, TokenBurnEvent,
    TokenCreateEvent, TokenMintEvent, TokenPoolEvent, TokenTransferEvent,
    TransferBatchEvent,
    TransferSingleEvent
} from '../src/tokens/tokens.interfaces';
import { TokensService } from '../src/tokens/tokens.service';
import { WebSocketMessage } from '../src/websocket-events/websocket-events.base';

const BASE_URL = 'http://eth';
const INSTANCE_PATH = '/tokens';
const ERC20_STANDARD = 'ERC20';
const F1_POOL_ID = 'F1';
const FUNG_TYPE_ID = '340282366920938463463374607431768211456';
const PREFIX = 'fly';
const TOPIC = 'tokentest';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const tokenCreateEventSignature = 'TokenCreate(address,uint256,bytes)';
const transferSingleEventSignature = 'TransferSingle(address,address,address,uint256,uint256)';
const transferBatchEventSignature = 'TransferBatch(address,address,address,uint256[],uint256[])';

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

describe('WebSocket AppController (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<typeof request>;
  let http: {
    get: ReturnType<typeof jest.fn>;
    post: ReturnType<typeof jest.fn>;
  };
  let eventHandler: (events: Event[]) => void;
  let receiptHandler: (receipt: EventStreamReply) => void;

  const eventstream = {
    connect: (
      url: string,
      topic: string,
      handleEvents: (events: Event[]) => void,
      handleReceipt: (receipt: EventStreamReply) => void,
    ) => {
      eventHandler = handleEvents;
      receiptHandler = handleReceipt;
    },

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

  it('Websocket: token pool event', () => {
    eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: TOPIC + ':F1',
    });

    return server
      .ws('/api/ws')
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([
          <TokenCreateEvent>{
            subId: 'sb123',
            signature: tokenCreateEventSignature,
            address: 'bob',
            blockNumber: '1',
            transactionIndex: '0x0',
            transactionHash: '0x123',
            data: {
              operator: 'bob',
              type_id: FUNG_TYPE_ID,
              data: '0x00',
            },
          },
        ]);
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        delete message.id;
        expect(message).toEqual(<WebSocketMessage>{
          event: 'token-pool',
          data: <TokenPoolEvent>{
            standard: ERC20_STANDARD,
            poolId: F1_POOL_ID,
            operator: 'bob',
            data: '',
            transaction: {
              blockNumber: '1',
              transactionIndex: '0x0',
              transactionHash: '0x123',
            },
          },
        });
        return true;
      });
  });

  it('Websocket: token pool event from base subscription', () => {
    eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: TOPIC + ':base',
    });

    return server
      .ws('/api/ws')
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([
          <TokenCreateEvent>{
            subId: 'sb123',
            signature: tokenCreateEventSignature,
            address: 'bob',
            blockNumber: '1',
            transactionIndex: '0x0',
            transactionHash: '0x123',
            data: {
              operator: 'bob',
              type_id: FUNG_TYPE_ID,
              data: '0x00',
            },
          },
        ]);
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        delete message.id;
        expect(message).toEqual(<WebSocketMessage>{
          event: 'token-pool',
          data: <TokenPoolEvent>{
            standard: ERC20_STANDARD,
            poolId: F1_POOL_ID,
            operator: 'bob',
            data: '',
            transaction: {
              blockNumber: '1',
              transactionIndex: '0x0',
              transactionHash: '0x123',
            },
          },
        });
        return true;
      });
  });

  it('Websocket: token mint event', async () => {
    eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: TOPIC + ':F1',
    });

    http.get = jest.fn(
      () =>
        new FakeObservable(<EthConnectReturn>{
          output: 'firefly://token/{id}',
        }),
    );

    await server
      .ws('/api/ws')
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([
          <TransferSingleEvent>{
            subId: 'sb-123',
            signature: transferSingleEventSignature,
            address: '',
            blockNumber: '1',
            transactionIndex: '0x0',
            transactionHash: '0x123',
            logIndex: '1',
            data: {
              id: FUNG_TYPE_ID,
              from: ZERO_ADDRESS,
              to: 'A',
              operator: 'A',
              value: '5',
              transaction: {
                blockNumber: '1',
                transactionIndex: '0x0',
                transactionHash: '0x123',
                logIndex: '1',
              },
            },
            inputMethod: 'mintFungible',
            inputArgs: {
              data: '0x74657374',
            },
          },
        ]);
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        delete message.id;
        expect(message).toEqual(<WebSocketMessage>{
          event: 'token-mint',
          data: <TokenMintEvent>{
            id: '1.0.1',
            poolId: F1_POOL_ID,
            to: 'A',
            amount: '5',
            operator: 'A',
            uri: 'firefly://token/0000000000000000000000000000000100000000000000000000000000000000',
            data: 'test',
            transaction: {
              blockNumber: '1',
              transactionIndex: '0x0',
              transactionHash: '0x123',
              logIndex: '1',
            },
          },
        });
        return true;
      });

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.get).toHaveBeenCalledWith(`${BASE_URL}${INSTANCE_PATH}/uri?input=0`, {});
  });
  // TODO: Confirm expected uri
  xit('Websocket: token burn event', async () => {
    eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: TOPIC + ':F1',
    });

    http.get = jest.fn(
      () =>
        new FakeObservable(<EthConnectReturn>{
          output: 'firefly://token/{id}',
        }),
    );

    await server
      .ws('/api/ws')
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([
          <TransferSingleEvent>{
            subId: 'sb-123',
            signature: transferSingleEventSignature,
            address: '',
            blockNumber: '1',
            transactionIndex: '0x0',
            transactionHash: '0x123',
            logIndex: '1',
            data: {
              id: FUNG_TYPE_ID,
              from: 'A',
              to: ZERO_ADDRESS,
              operator: 'A',
              value: '1',
              transaction: {
                blockNumber: '1',
                transactionIndex: '0x0',
                transactionHash: '0x123',
              },
            },
            inputMethod: 'burn',
            inputArgs: {
              data: '0x74657374',
            },
          },
        ]);
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        delete message.id;
        expect(message).toEqual(<WebSocketMessage>{
          event: 'token-burn',
          data: <TokenBurnEvent>{
            id: '1.0.1',
            poolId: F1_POOL_ID,
            tokenIndex: '1',
            from: 'A',
            amount: '1',
            operator: 'A',
            uri: 'firefly://token/8000000000000000000000000000000100000000000000000000000000000001',
            data: 'test',
            transaction: {
              blockNumber: '1',
              transactionIndex: '0x0',
              transactionHash: '0x123',
              logIndex: '1',
            },
          },
        });
        return true;
      });

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.get).toHaveBeenCalledWith(`${BASE_URL}${INSTANCE_PATH}/uri?input=0`, {});
  });
  // TODO: Confirm expected uri
  xit('Websocket: token transfer event', async () => {
    eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: TOPIC + ':F1',
    });

    http.get = jest.fn(
      () =>
        new FakeObservable(<EthConnectReturn>{
          output: 'firefly://token/{id}',
        }),
    );

    await server
      .ws('/api/ws')
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([
          <TransferSingleEvent>{
            subId: 'sb123',
            signature: transferSingleEventSignature,
            address: '',
            blockNumber: '1',
            transactionIndex: '0x0',
            transactionHash: '0x123',
            logIndex: '1',
            data: {
              id: FUNG_TYPE_ID,
              from: 'A',
              to: 'B',
              operator: 'A',
              value: '1',
            },
          },
        ]);
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        delete message.id;
        expect(message).toEqual(<WebSocketMessage>{
          event: 'token-transfer',
          data: <TokenTransferEvent>{
            id: '1.0.1',
            poolId: F1_POOL_ID,
            tokenIndex: '1',
            from: 'A',
            to: 'B',
            amount: '1',
            operator: 'A',
            uri: 'firefly://token/8000000000000000000000000000000100000000000000000000000000000001',
            data: '',
            transaction: {
              blockNumber: '1',
              transactionIndex: '0x0',
              transactionHash: '0x123',
              logIndex: '1',
            },
          },
        });
        return true;
      });

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.get).toHaveBeenCalledWith(`${BASE_URL}${INSTANCE_PATH}/uri?input=0`, {});
  });

  // TODO: Discuss expected blockNumber
  it('Websocket: token transfer event from wrong pool', () => {
    eventstream.getSubscription
      .mockReturnValueOnce(<EventStreamSubscription>{ name: TOPIC + ':F1' })
      .mockReturnValueOnce(<EventStreamSubscription>{ name: TOPIC + ':F1' });

    return server
      .ws('/api/ws')
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([
          <TransferSingleEvent>{
            subId: 'sb123',
            signature: transferSingleEventSignature,
            address: '',
            blockNumber: '1',
            transactionIndex: '0x0',
            transactionHash: '0x123',
            data: {
              id: FUNG_TYPE_ID,
              from: 'A',
              to: 'B',
              operator: 'A',
              value: '1',
            },
          },
          <TransferSingleEvent>{
            subId: 'sb123',
            signature: transferSingleEventSignature,
            address: '',
            blockNumber: '2',
            transactionIndex: '0x0',
            transactionHash: '0x123',
            data: {
              id: FUNG_TYPE_ID,
              from: 'A',
              to: 'B',
              operator: 'A',
              value: '1',
            },
          },
        ]);
      })
      .expectJson(message => {
        // Only the second transfer should have been processed
        expect(message.event).toEqual('token-transfer');
        expect(message.data.poolId).toEqual('F1');
        // expect(message.data.transaction.blockNumber).toEqual('2');
        return true;
      });
  });

  // TODO: Confirm expected token index
  it('Websocket: token batch transfer', async () => {
    eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: TOPIC + ':F1',
    });

    http.get = jest.fn(
      () =>
        new FakeObservable(<EthConnectReturn>{
          output: 'firefly://token/{id}',
        }),
    );

    await server
      .ws('/api/ws')
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([
          <TransferBatchEvent>{
            subId: 'sb123',
            signature: transferBatchEventSignature,
            address: '',
            blockNumber: '1',
            transactionIndex: '0x0',
            transactionHash: '0x123',
            logIndex: '1',
            data: {
              from: 'A',
              to: 'B',
              operator: 'A',
              ids: [
                '57896044618658097711785492504343953926975274699741220483192166611388333031425',
                '57896044618658097711785492504343953926975274699741220483192166611388333031426',
              ],
              values: ['1', '1'],
            },
          },
        ]);
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        delete message.id;
        expect(message).toEqual(<WebSocketMessage>{
          event: 'token-transfer',
          data: <TokenTransferEvent>{
            id: '1.0.1.0',
            poolId: F1_POOL_ID,
            tokenIndex: undefined,
            from: 'A',
            to: 'B',
            amount: '1',
            operator: 'A',
            uri: 'firefly://token/8000000000000000000000000000000100000000000000000000000000000001',
            data: '',
            transaction: {
              blockNumber: '1',
              transactionIndex: '0x0',
              transactionHash: '0x123',
              logIndex: '1',
            },
          },
        });
        return true;
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        delete message.id;
        expect(message).toEqual(<WebSocketMessage>{
          event: 'token-transfer',
          data: <TokenTransferEvent>{
            id: '1.0.1.1',
            poolId: F1_POOL_ID,
            tokenIndex: undefined,
            from: 'A',
            to: 'B',
            amount: '1',
            operator: 'A',
            uri: 'firefly://token/8000000000000000000000000000000100000000000000000000000000000002',
            data: '',
            transaction: {
              blockNumber: '1',
              transactionIndex: '0x0',
              transactionHash: '0x123',
              logIndex: '1',
            },
          },
        });
        return true;
      });

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.get).toHaveBeenCalledWith(`${BASE_URL}${INSTANCE_PATH}/uri?input=0`, {});
  });

  it('Websocket: success receipt', () => {
    return server
      .ws('/api/ws')
      .exec(() => {
        expect(receiptHandler).toBeDefined();
        receiptHandler(<EventStreamReply>{
          headers: {
            requestId: '1',
            type: 'TransactionSuccess',
          },
        });
      })
      .expectJson(message => {
        expect(message).toEqual(<WebSocketMessage>{
          event: 'receipt',
          data: <ReceiptEvent>{
            id: '1',
            success: true,
          },
        });
        return true;
      });
  });

  it('Websocket: error receipt', () => {
    return server
      .ws('/api/ws')
      .exec(() => {
        expect(receiptHandler).toBeDefined();
        receiptHandler(<EventStreamReply>{
          headers: {
            requestId: '1',
            type: 'Error',
          },
          errorMessage: 'Failed',
        });
      })
      .expectJson(message => {
        expect(message).toEqual(<WebSocketMessage>{
          event: 'receipt',
          data: <ReceiptEvent>{
            id: '1',
            success: false,
            message: 'Failed',
          },
        });
        return true;
      });
  });

  it('Websocket: disconnect and reconnect', async () => {
    const tokenPoolMessage: TokenCreateEvent = {
      subId: 'sb-123',
      signature: tokenCreateEventSignature,
      address: 'bob',
      blockNumber: '1',
      transactionIndex: '0x0',
      transactionHash: '0x123',
      logIndex: '1',
      data: {
        operator: 'bob',
        type_id: FUNG_TYPE_ID,
        data: '0x6e73006e616d65006964',
      },
    };

    eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: TOPIC + ':F1',
    });

    await server
      .ws('/api/ws')
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([tokenPoolMessage]);
      })
      .expectJson(message => {
        expect(message.event).toEqual('token-pool');
        return true;
      })
      .close();

    await server.ws('/api/ws').expectJson(message => {
      expect(message.event).toEqual('token-pool');
      return true;
    });
  });

  it('Websocket: client switchover', async () => {
    const tokenPoolMessage: TokenCreateEvent = {
      subId: 'sb-123',
      signature: tokenCreateEventSignature,
      address: 'bob',
      blockNumber: '1',
      transactionIndex: '0x0',
      transactionHash: '0x123',
      logIndex: '1',
      data: {
        operator: 'bob',
        type_id: FUNG_TYPE_ID,
        data: '0x6e73006e616d65006964',
      },
    };

    eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: TOPIC + ':F1',
    });

    const ws1 = server.ws('/api/ws');
    const ws2 = server.ws('/api/ws');

    await ws1
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([tokenPoolMessage]);
      })
      .expectJson(message => {
        expect(message.event).toEqual('token-pool');
        return true;
      })
      .close();

    await ws2.expectJson(message => {
      expect(message.event).toEqual('token-pool');
      return true;
    });
  });

  it('Websocket: batch + ack + client switchover', async () => {
    const tokenPoolMessage: TokenCreateEvent = {
      subId: 'sb-123',
      signature: tokenCreateEventSignature,
      address: 'bob',
      blockNumber: '1',
      transactionIndex: '0x0',
      transactionHash: '0x123',
      logIndex: '1',
      data: {
        operator: 'bob',
        type_id: FUNG_TYPE_ID,
        data: '0x6e73006e616d65006964',
      },
    };
    const tokenMintMessage: TransferSingleEvent = {
      subId: 'sb-123',
      signature: transferSingleEventSignature,
      address: '',
      blockNumber: '1',
      transactionIndex: '0x0',
      transactionHash: '0x123',
      logIndex: '1',
      data: {
        id: FUNG_TYPE_ID,
        from: ZERO_ADDRESS,
        to: 'A',
        operator: 'A',
        value: '5',
      },
    };

    eventstream.getSubscription
      .mockReturnValueOnce(<EventStreamSubscription>{ name: TOPIC + ':F1' })
      .mockReturnValueOnce(<EventStreamSubscription>{ name: TOPIC + ':F1' });

    const ws1 = server.ws('/api/ws');
    const ws2 = server.ws('/api/ws');
    let messageID1: string;

    await ws1
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([tokenPoolMessage, tokenMintMessage]);
      })
      .expectJson(message => {
        expect(message.event).toEqual('token-pool');
        messageID1 = message.id;
        return true;
      })
      .expectJson(message => {
        expect(message.event).toEqual('token-mint');
        return true;
      })
      .exec(client => {
        client.send(
          JSON.stringify({
            event: 'ack',
            data: { id: messageID1 },
          }),
        );
      })
      .close();

    await ws2.expectJson(message => {
      expect(message.event).toEqual('token-mint');
      return true;
    });
  });
});
