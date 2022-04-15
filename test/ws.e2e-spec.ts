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
import { Observer } from 'rxjs';
import { AxiosResponse } from '@nestjs/terminus/dist/health-indicator/http/axios.interfaces';
import { AppModule } from '../src/app.module';
import {
  Event,
  EventStreamReply,
  EventStreamSubscription,
} from '../src/event-stream/event-stream.interfaces';
import { EventStreamService } from '../src/event-stream/event-stream.service';
import { EventStreamProxyGateway } from '../src/eventstream-proxy/eventstream-proxy.gateway';
import { ReceiptEvent } from '../src/eventstream-proxy/eventstream-proxy.interfaces';
import {
  EthConnectReturn,
  TokenBurnEvent,
  TokenMintEvent,
  TokenTransferEvent,
  TokenType,
  TransferEvent,
} from '../src/tokens/tokens.interfaces';
import { TokensService } from '../src/tokens/tokens.service';
import { WebSocketMessage } from '../src/websocket-events/websocket-events.base';

const BASE_URL = 'http://eth';
const CONTRACT_ADDRESS = '0x123456';
const IDENTITY = '0x321';
const PREFIX = 'fly';
const TOPIC = 'tokentest';
const ERC20_STANDARD = 'ERC20WithData';
const ERC20_POOL_ID = `address=${CONTRACT_ADDRESS}&schema=${ERC20_STANDARD}&type=${TokenType.FUNGIBLE}`;
const ERC721_STANDARD = 'ERC721WithData';
const ERC721_POOL_ID = `address=${CONTRACT_ADDRESS}&schema=${ERC721_STANDARD}&type=${TokenType.NONFUNGIBLE}`;
const ERC721_BASE_URI = 'firefly://token/';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const transferEventSignature = 'Transfer(address,address,uint256)';

const mockERC20MintTransferEvent: TransferEvent = {
  subId: 'sb-123',
  signature: transferEventSignature,
  operator: 'A',
  address: 'bob',
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
  inputSigner: IDENTITY,
};

const mockERC20TransferEvent: TransferEvent = {
  operator: 'A',
  subId: 'sb-123',
  signature: transferEventSignature,
  address: 'bob',
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
  inputSigner: IDENTITY,
};

const mockERC20BurnEvent: TransferEvent = {
  subId: 'sb-123',
  signature: transferEventSignature,
  address: 'bob',
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
  inputSigner: IDENTITY,
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

  it('Websocket: ERC20 token mint event', async () => {
    eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: TOPIC + ':' + ERC20_POOL_ID,
    });

    const mockMintWebSocketMessage: WebSocketMessage = {
      event: 'token-mint',
      data: <TokenMintEvent>{
        id: '000000000001/000000/000001',
        poolLocator: ERC20_POOL_ID,
        to: 'A',
        amount: '5',
        signer: IDENTITY,
        data: 'test',
        blockchain: {
          id: '000000000001/000000/000001',
          name: 'Transfer',
          location: 'address=bob',
          signature: transferEventSignature,
          timestamp: '2020-01-01 00:00:00Z',
          output: {
            from: ZERO_ADDRESS,
            to: 'A',
            value: '5',
          },
          info: {
            address: 'bob',
            blockNumber: '1',
            transactionIndex: '0x0',
            transactionHash: '0x123',
            logIndex: '1',
            signature: transferEventSignature,
          },
        },
      },
    };

    await server
      .ws('/api/ws')
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([mockERC20MintTransferEvent]);
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        delete message.id;
        expect(message).toEqual(mockMintWebSocketMessage);
        return true;
      });
  });

  it('Websocket: ERC20 token mint event with old locator', async () => {
    eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name:
        TOPIC +
        ':' +
        `address=${CONTRACT_ADDRESS}&standard=${ERC20_STANDARD}&type=${TokenType.FUNGIBLE}`,
    });

    const mockMintWebSocketMessage: WebSocketMessage = {
      event: 'token-mint',
      data: <TokenMintEvent>{
        id: '000000000001/000000/000001',
        poolLocator: `address=${CONTRACT_ADDRESS}&standard=${ERC20_STANDARD}&type=${TokenType.FUNGIBLE}`,
        to: 'A',
        amount: '5',
        signer: IDENTITY,
        data: 'test',
        blockchain: {
          id: '000000000001/000000/000001',
          name: 'Transfer',
          location: 'address=bob',
          signature: transferEventSignature,
          timestamp: '2020-01-01 00:00:00Z',
          output: {
            from: ZERO_ADDRESS,
            to: 'A',
            value: '5',
          },
          info: {
            address: 'bob',
            blockNumber: '1',
            transactionIndex: '0x0',
            transactionHash: '0x123',
            logIndex: '1',
            signature: transferEventSignature,
          },
        },
      },
    };

    await server
      .ws('/api/ws')
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([mockERC20MintTransferEvent]);
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        delete message.id;
        expect(message).toEqual(mockMintWebSocketMessage);
        return true;
      });
  });

  it('Websocket: ERC721 token mint event', async () => {
    eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: TOPIC + ':' + ERC721_POOL_ID,
    });

    const baseUriResponse: EthConnectReturn = {
      output: ERC721_BASE_URI,
    };

    http.post = jest.fn(() => new FakeObservable(baseUriResponse));

    const mockERC721MintTransferEvent: TransferEvent = {
      subId: 'sb-123',
      signature: transferEventSignature,
      operator: 'A',
      address: 'bob',
      blockNumber: '1',
      transactionIndex: '0x0',
      transactionHash: '0x123',
      logIndex: '1',
      timestamp: '2020-01-01 00:00:00Z',
      data: {
        from: ZERO_ADDRESS,
        to: 'A',
        tokenId: '721',
      },
      inputMethod: 'mintWithData',
      inputArgs: {
        tokenId: '721',
        data: '0x74657374',
        to: 'A',
      },
      inputSigner: IDENTITY,
    };

    const mockMintWebSocketMessage: WebSocketMessage = {
      event: 'token-mint',
      data: <TokenMintEvent>{
        id: '000000000001/000000/000001',
        poolLocator: ERC721_POOL_ID,
        to: 'A',
        amount: '1',
        signer: IDENTITY,
        data: 'test',
        blockchain: {
          id: '000000000001/000000/000001',
          name: 'Transfer',
          location: 'address=bob',
          signature: transferEventSignature,
          timestamp: '2020-01-01 00:00:00Z',
          output: {
            from: ZERO_ADDRESS,
            to: 'A',
            tokenId: '721',
          },
          info: {
            address: 'bob',
            blockNumber: '1',
            transactionIndex: '0x0',
            transactionHash: '0x123',
            logIndex: '1',
            signature: transferEventSignature,
          },
        },
        tokenIndex: '721',
        uri: ERC721_BASE_URI,
      },
    };

    await server
      .ws('/api/ws')
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([mockERC721MintTransferEvent]);
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        delete message.id;
        expect(message).toEqual(mockMintWebSocketMessage);
        return true;
      });
  });

  it('Websocket: ERC20 token transfer event', async () => {
    eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: TOPIC + ':' + ERC20_POOL_ID,
    });

    const mockTransferWebSocketMessage: WebSocketMessage = {
      event: 'token-transfer',
      data: <TokenTransferEvent>{
        id: '000000000001/000000/000001',
        poolLocator: ERC20_POOL_ID,
        from: 'A',
        to: 'B',
        amount: '5',
        signer: IDENTITY,
        data: 'test',
        blockchain: {
          id: '000000000001/000000/000001',
          name: 'Transfer',
          location: 'address=bob',
          signature: transferEventSignature,
          timestamp: '2020-01-01 00:00:00Z',
          output: {
            from: 'A',
            to: 'B',
            value: '5',
          },
          info: {
            address: 'bob',
            blockNumber: '1',
            transactionIndex: '0x0',
            transactionHash: '0x123',
            logIndex: '1',
            signature: transferEventSignature,
          },
        },
      },
    };

    await server
      .ws('/api/ws')
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([mockERC20TransferEvent]);
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        delete message.id;
        expect(message).toEqual(mockTransferWebSocketMessage);
        return true;
      });
  });

  it('Websocket: ERC721 token transfer event', async () => {
    eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: TOPIC + ':' + ERC721_POOL_ID,
    });

    const baseUriResponse: EthConnectReturn = {
      output: ERC721_BASE_URI,
    };

    http.post = jest.fn(() => new FakeObservable(baseUriResponse));

    const mockERC721TransferEvent: TransferEvent = {
      subId: 'sb-123',
      signature: transferEventSignature,
      operator: 'A',
      address: 'bob',
      blockNumber: '1',
      transactionIndex: '0x0',
      transactionHash: '0x123',
      logIndex: '1',
      timestamp: '2020-01-01 00:00:00Z',
      data: {
        from: 'A',
        to: 'B',
        tokenId: '721',
      },
      inputMethod: 'transferWithData',
      inputArgs: {
        tokenIndex: '721',
        data: '0x74657374',
        from: 'A',
        to: 'B',
      },
      inputSigner: IDENTITY,
    };

    const mockTransferWebSocketMessage: WebSocketMessage = {
      event: 'token-transfer',
      data: <TokenTransferEvent>{
        id: '000000000001/000000/000001',
        poolLocator: ERC721_POOL_ID,
        from: 'A',
        to: 'B',
        amount: '1',
        signer: IDENTITY,
        data: 'test',
        blockchain: {
          id: '000000000001/000000/000001',
          name: 'Transfer',
          location: 'address=bob',
          signature: transferEventSignature,
          timestamp: '2020-01-01 00:00:00Z',
          output: {
            from: 'A',
            to: 'B',
            tokenId: '721',
          },
          info: {
            address: 'bob',
            blockNumber: '1',
            transactionIndex: '0x0',
            transactionHash: '0x123',
            logIndex: '1',
            signature: transferEventSignature,
          },
        },
        tokenIndex: '721',
        uri: ERC721_BASE_URI,
      },
    };

    await server
      .ws('/api/ws')
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([mockERC721TransferEvent]);
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        delete message.id;
        expect(message).toEqual(mockTransferWebSocketMessage);
        return true;
      });
  });

  it('Websocket: ERC20 token burn event', async () => {
    eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: TOPIC + ':' + ERC20_POOL_ID,
    });

    const mockBurnWebSocketMessage: WebSocketMessage = {
      event: 'token-burn',
      data: <TokenBurnEvent>{
        id: '000000000001/000000/000001',
        poolLocator: ERC20_POOL_ID,
        from: 'B',
        amount: '5',
        signer: IDENTITY,
        data: 'test',
        blockchain: {
          id: '000000000001/000000/000001',
          name: 'Transfer',
          location: 'address=bob',
          signature: transferEventSignature,
          timestamp: '2020-01-01 00:00:00Z',
          output: {
            from: 'B',
            to: ZERO_ADDRESS,
            value: '5',
          },
          info: {
            address: 'bob',
            blockNumber: '1',
            transactionIndex: '0x0',
            transactionHash: '0x123',
            logIndex: '1',
            signature: transferEventSignature,
          },
        },
      },
    };

    await server
      .ws('/api/ws')
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([mockERC20BurnEvent]);
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        delete message.id;
        expect(message).toEqual(mockBurnWebSocketMessage);
        return true;
      });
  });

  it('Websocket: ERC721 token burn event', async () => {
    eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: TOPIC + ':' + ERC721_POOL_ID,
    });

    const baseUriResponse: EthConnectReturn = {
      output: '',
    };

    http.post = jest.fn(() => new FakeObservable(baseUriResponse));

    const mockERC721BurnEvent: TransferEvent = {
      subId: 'sb-123',
      signature: transferEventSignature,
      address: 'bob',
      operator: 'A',
      blockNumber: '1',
      transactionIndex: '0x0',
      transactionHash: '0x123',
      logIndex: '1',
      timestamp: '2020-01-01 00:00:00Z',
      data: {
        from: 'B',
        to: ZERO_ADDRESS,
        tokenId: '721',
      },
      inputMethod: 'burnWithData',
      inputArgs: {
        tokenIndex: '721',
        data: '0x74657374',
        from: 'B',
      },
      inputSigner: IDENTITY,
    };

    const mockBurnWebSocketMessage: WebSocketMessage = {
      event: 'token-burn',
      data: <TokenBurnEvent>{
        id: '000000000001/000000/000001',
        poolLocator: ERC721_POOL_ID,
        from: 'B',
        amount: '1',
        signer: IDENTITY,
        data: 'test',
        blockchain: {
          id: '000000000001/000000/000001',
          name: 'Transfer',
          location: 'address=bob',
          signature: transferEventSignature,
          timestamp: '2020-01-01 00:00:00Z',
          output: {
            from: 'B',
            to: ZERO_ADDRESS,
            tokenId: '721',
          },
          info: {
            address: 'bob',
            blockNumber: '1',
            transactionIndex: '0x0',
            transactionHash: '0x123',
            logIndex: '1',
            signature: transferEventSignature,
          },
        },
        tokenIndex: '721',
        uri: '', // Burned tokens have no URI
      },
    };

    await server
      .ws('/api/ws')
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([mockERC721BurnEvent]);
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        delete message.id;
        expect(message).toEqual(mockBurnWebSocketMessage);
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
        eventHandler([mockERC20MintTransferEvent]);
      })
      .expectJson(message => {
        expect(message.event).toEqual('token-mint');
        return true;
      })
      .close();

    await server.ws('/api/ws').expectJson(message => {
      expect(message.event).toEqual('token-mint');
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
        eventHandler([mockERC20MintTransferEvent]);
      })
      .expectJson(message => {
        expect(message.event).toEqual('token-mint');
        return true;
      })
      .close();

    await ws2.expectJson(message => {
      expect(message.event).toEqual('token-mint');
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
      inputMethod: 'mintWithData',
      inputArgs: {
        amount: '5',
        data: '0x74657374',
        to: 'A',
      },
      inputSigner: IDENTITY,
    };

    eventstream.getSubscription
      .mockReturnValueOnce(<EventStreamSubscription>{ name: TOPIC + ':' + CONTRACT_ADDRESS })
      .mockReturnValueOnce(<EventStreamSubscription>{ name: TOPIC + ':' + CONTRACT_ADDRESS });

    const ws1 = server.ws('/api/ws');
    const ws2 = server.ws('/api/ws');
    let messageID1: string;

    await ws1
      .exec(() => {
        expect(eventHandler).toBeDefined();
        eventHandler([mockERC20TransferEvent, tokenMintMessage]);
      })
      .expectJson(message => {
        expect(message.event).toEqual('token-transfer');
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
