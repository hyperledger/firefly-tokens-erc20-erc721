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
import request from 'superwstest';
import { AppModule } from '../src/app.module';
import {
  Event,
  EventStreamReply,
  EventStreamSubscription,
  TokenCreateEvent,
  TransferEvent,
} from '../src/event-stream/event-stream.interfaces';
import { EventStreamService } from '../src/event-stream/event-stream.service';
import { EventStreamProxyGateway } from '../src/eventstream-proxy/eventstream-proxy.gateway';
import { ReceiptEvent } from '../src/eventstream-proxy/eventstream-proxy.interfaces';
import {
  TokenBurnEvent,
  TokenMintEvent,
  TokenPoolEvent,
  TokenTransferEvent,
  TokenType,
} from '../src/tokens/tokens.interfaces';
import { TokensService } from '../src/tokens/tokens.service';
import { WebSocketMessage } from '../src/websocket-events/websocket-events.base';

const BASE_URL = 'http://eth';
const CONTRACT_ABI = '123';
const CONTRACT_ADDRESS = '0x123456';
const INSTANCE_PATH = '/tokens';
const ERC20_STANDARD = 'ERC20';
const PREFIX = 'fly';
const TOPIC = 'tokentest';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const tokenCreateEventSignature = 'TokenCreate(address,address,string,string,bytes)';
const transferEventSignature = 'Transfer(address,address,uint256)';

const mockTokenCreateEvent: TokenCreateEvent = {
  subId: 'sb123',
  signature: tokenCreateEventSignature,
  address: 'bob',
  blockNumber: '1',
  transactionIndex: '0x0',
  operator: 'bob',
  transactionHash: '0x123',
  logIndex: '1',
  timestamp: '2020-01-01 00:00:00Z',
  data: {
    contract_address: '0x123456',
    data: '0x00',
    name: 'testName',
    operator: 'bob',
    symbol: 'testSymbol',
  },
};

const mockTokenCreateWebSocketMessage: WebSocketMessage = {
  event: 'token-pool',
  data: <TokenPoolEvent>{
    standard: ERC20_STANDARD,
    poolId: CONTRACT_ADDRESS,
    type: TokenType.FUNGIBLE,
    operator: 'bob',
    data: '',
    timestamp: '2020-01-01 00:00:00Z',
    rawOutput: {
      contract_address: '0x123456',
      data: '0x00',
      name: 'testName',
      operator: 'bob',
      symbol: 'testSymbol',
    },
    transaction: {
      logIndex: '1',
      blockNumber: '1',
      transactionIndex: '0x0',
      transactionHash: '0x123',
      signature: tokenCreateEventSignature,
    },
  },
};

describe('WebSocket AppController (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<typeof request>;
  let http: {
    get: ReturnType<typeof jest.fn>;
    post: ReturnType<typeof jest.fn>;
  };
  let tokensService: TokensService;
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
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    tokensService = moduleFixture.get<TokensService>(TokensService);
    await app.init();

    app.get(EventStreamProxyGateway).configure('url', TOPIC);
    app.get(TokensService).configure(BASE_URL, INSTANCE_PATH, TOPIC, PREFIX, CONTRACT_ABI, '', '');

    (app.getHttpServer() as Server).listen();
    server = request(app.getHttpServer());
  });

  afterEach(async () => {
    await app.close();
  });

  it('Websocket: token create event', () => {
    eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: TOPIC + ':' + CONTRACT_ADDRESS,
    });

    return server
      .ws('/api/ws')
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([mockTokenCreateEvent]);
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        delete message.id;
        expect(message).toEqual(mockTokenCreateWebSocketMessage);
        return true;
      });
  });

  it('Websocket: token create event from base subscription', () => {
    eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: TOPIC + ':base',
    });

    return server
      .ws('/api/ws')
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([mockTokenCreateEvent]);
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        delete message.id;
        expect(message).toEqual(mockTokenCreateWebSocketMessage);
        return true;
      });
  });

  it('Websocket: token mint event', async () => {
    eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: TOPIC + ':' + CONTRACT_ADDRESS,
    });
    jest.spyOn(tokensService, 'getOperator').mockResolvedValueOnce('A');

    const mockMintTransferEvent: TransferEvent = {
      subId: 'sb-123',
      signature: transferEventSignature,
      operator: 'A',
      address: '',
      blockNumber: '1',
      transactionIndex: '0x0',
      transactionHash: '0x123',
      logIndex: '1',
      timestamp: '2020-01-01 00:00:00Z',
      data: {
        from: ZERO_ADDRESS,
        to: 'A',
        value: '5',
      },
      inputMethod: 'mintWithData',
      inputArgs: {
        amount: '5',
        data: '0x74657374',
        to: 'A',
      },
    };

    const mockMintWebSocketMessage: WebSocketMessage = {
      event: 'token-mint',
      data: {
        id: '1.0.1',
        poolId: CONTRACT_ADDRESS,
        to: 'A',
        amount: '5',
        operator: 'A',
        data: 'test',
        timestamp: '2020-01-01 00:00:00Z',
        rawOutput: {
          from: ZERO_ADDRESS,
          to: 'A',
          value: '5',
        },
        transaction: {
          blockNumber: '1',
          transactionIndex: '0x0',
          transactionHash: '0x123',
          logIndex: '1',
          signature: transferEventSignature,
        },
        type: 'fungible',
      } as TokenMintEvent,
    };

    await server
      .ws('/api/ws')
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([mockMintTransferEvent]);
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        delete message.id;
        expect(message).toEqual(mockMintWebSocketMessage);
        return true;
      });
  });

  it('Websocket: token transfer event', async () => {
    eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: TOPIC + ':' + CONTRACT_ADDRESS,
    });
    jest.spyOn(tokensService, 'getOperator').mockResolvedValueOnce('A');

    const mockTransferEvent: TransferEvent = {
      operator: 'A',
      subId: 'sb-123',
      signature: transferEventSignature,
      address: '',
      blockNumber: '1',
      transactionIndex: '0x0',
      transactionHash: '0x123',
      logIndex: '1',
      timestamp: '2020-01-01 00:00:00Z',
      data: {
        from: 'A',
        to: 'B',
        value: '5',
      },
      inputMethod: 'transferWithData',
      inputArgs: {
        amount: '5',
        data: '0x74657374',
        from: 'A',
        to: 'B',
      },
    };

    const mockTransferWebSocketMessage: WebSocketMessage = {
      event: 'token-transfer',
      data: {
        id: '1.0.1',
        poolId: CONTRACT_ADDRESS,
        from: 'A',
        to: 'B',
        amount: '5',
        operator: 'A',
        data: 'test',
        timestamp: '2020-01-01 00:00:00Z',
        rawOutput: {
          from: 'A',
          to: 'B',
          value: '5',
        },
        transaction: {
          blockNumber: '1',
          transactionIndex: '0x0',
          transactionHash: '0x123',
          logIndex: '1',
          signature: transferEventSignature,
        },
        type: 'fungible',
      } as TokenTransferEvent,
    };

    await server
      .ws('/api/ws')
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([mockTransferEvent]);
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        delete message.id;
        expect(message).toEqual(mockTransferWebSocketMessage);
        return true;
      });
  });

  it('Websocket: token burn event', async () => {
    eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: TOPIC + ':' + CONTRACT_ADDRESS,
    });
    jest.spyOn(tokensService, 'getOperator').mockResolvedValueOnce('A');

    const mockBurnEvent: TransferEvent = {
      subId: 'sb-123',
      signature: transferEventSignature,
      address: '',
      operator: 'A',
      blockNumber: '1',
      transactionIndex: '0x0',
      transactionHash: '0x123',
      logIndex: '1',
      timestamp: '2020-01-01 00:00:00Z',
      data: {
        from: 'B',
        to: ZERO_ADDRESS,
        value: '5',
      },
      inputMethod: 'burnWithData',
      inputArgs: {
        amount: '5',
        data: '0x74657374',
        from: 'B',
      },
    };

    const mockBurnWebSocketMessage: WebSocketMessage = {
      event: 'token-burn',
      data: {
        id: '1.0.1',
        poolId: CONTRACT_ADDRESS,
        from: 'B',
        amount: '5',
        operator: 'A',
        data: 'test',
        timestamp: '2020-01-01 00:00:00Z',
        rawOutput: {
          from: 'B',
          to: ZERO_ADDRESS,
          value: '5',
        },
        transaction: {
          blockNumber: '1',
          transactionIndex: '0x0',
          transactionHash: '0x123',
          logIndex: '1',
          signature: transferEventSignature,
        },
        type: 'fungible',
      } as TokenBurnEvent,
    };

    await server
      .ws('/api/ws')
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([mockBurnEvent]);
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        delete message.id;
        expect(message).toEqual(mockBurnWebSocketMessage);
        return true;
      });
  });

  it('Websocket: token transfer event from wrong pool', () => {
    eventstream.getSubscription
      .mockReturnValueOnce(<EventStreamSubscription>{ name: TOPIC + ':' + CONTRACT_ADDRESS })
      .mockReturnValueOnce(<EventStreamSubscription>{ name: TOPIC + ':' + CONTRACT_ADDRESS });
    jest.spyOn(tokensService, 'getOperator').mockResolvedValue('A');
    return server
      .ws('/api/ws')
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([
          <TransferEvent>{
            subId: 'sb123',
            signature: transferEventSignature,
            address: '',
            blockNumber: '1',
            transactionIndex: '0x0',
            operator: 'A',
            transactionHash: '0x123',
            data: {
              from: 'A',
              to: 'B',
              value: '1',
            },
          },
          <TransferEvent>{
            subId: 'sb123',
            signature: transferEventSignature,
            address: '',
            blockNumber: '2',
            operator: 'A',
            transactionIndex: '0x0',
            transactionHash: '0x123',
            data: {
              from: 'A',
              to: 'B',
              value: '1',
            },
          },
        ]);
      })
      .expectJson(message => {
        // Only the second transfer should have been processed
        expect(message.event).toEqual('token-transfer');
        expect(message.data.poolId).toEqual('0x123456');
        expect(message.data.transaction.blockNumber).toEqual('1');
        return true;
      });
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
    eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: TOPIC + ':' + CONTRACT_ADDRESS,
    });

    await server
      .ws('/api/ws')
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([mockTokenCreateEvent]);
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
    eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: TOPIC + ':' + CONTRACT_ADDRESS,
    });

    const ws1 = server.ws('/api/ws');
    const ws2 = server.ws('/api/ws');

    await ws1
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([mockTokenCreateEvent]);
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
    const tokenMintMessage: TransferEvent = {
      subId: 'sb-123',
      signature: transferEventSignature,
      address: '',
      blockNumber: '1',
      transactionIndex: '0x0',
      transactionHash: '0x123',
      timestamp: '2020-01-01 00:00:00Z',
      operator: 'A',
      logIndex: '1',
      data: {
        from: ZERO_ADDRESS,
        to: 'A',
        value: '5',
      },
    };

    eventstream.getSubscription
      .mockReturnValueOnce(<EventStreamSubscription>{ name: TOPIC + ':' + CONTRACT_ADDRESS })
      .mockReturnValueOnce(<EventStreamSubscription>{ name: TOPIC + ':' + CONTRACT_ADDRESS });
    jest.spyOn(tokensService, 'getOperator').mockResolvedValueOnce('A');

    const ws1 = server.ws('/api/ws');
    const ws2 = server.ws('/api/ws');
    let messageID1: string;

    await ws1
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([mockTokenCreateEvent, tokenMintMessage]);
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
