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

import { packSubscriptionName } from '../../src/tokens/tokens.util';
import {
  EventStreamReply,
  EventStreamSubscription,
} from '../../src/event-stream/event-stream.interfaces';
import {
  ApprovalForAllEvent,
  ERC20ApprovalEvent,
  ERC721ApprovalEvent,
  EthConnectReturn,
  TokenApprovalEvent,
  TokenBurnEvent,
  TokenMintEvent,
  TokenTransferEvent,
  TokenType,
  TransferEvent,
} from '../../src/tokens/tokens.interfaces';
import { WebSocketMessage } from '../../src/websocket-events/websocket-events.base';
import { FakeObservable, TestContext } from '../app.e2e-context';

const CONTRACT_ADDRESS = '0x123456';
const IDENTITY = '0x321';
const TOPIC = 'tokentest';
const ERC20_STANDARD = 'ERC20WithData';
const ERC20_POOL_ID = `address=${CONTRACT_ADDRESS}&schema=${ERC20_STANDARD}&type=${TokenType.FUNGIBLE}`;
const ERC721_STANDARD = 'ERC721WithData';
const ERC721_POOL_ID = `address=${CONTRACT_ADDRESS}&schema=${ERC721_STANDARD}&type=${TokenType.NONFUNGIBLE}`;
const ERC721_BASE_URI = 'firefly://token/';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const transferEventSignature = 'Transfer(address,address,uint256)';
const approvalEventSignature = 'Approval(address,address,uint256)';
const approvalForAllEventSignature = 'ApprovalForAll(address,address,bool)';

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

const mockERC20ApprovalEvent: ERC20ApprovalEvent = {
  subId: 'sb-123',
  signature: approvalEventSignature,
  address: 'bob',
  operator: 'A',
  blockNumber: '1',
  transactionIndex: '0x0',
  transactionHash: '0x123',
  logIndex: '1',
  timestamp: '2020-01-01 00:00:00Z',
  data: {
    owner: IDENTITY,
    spender: 'B',
    value: '5',
  },
  inputMethod: 'approveWithData',
  inputArgs: {
    amount: '5',
    data: '0x74657374',
    spender: 'B',
  },
  inputSigner: IDENTITY,
};

const mockERC721ApprovalEvent: ERC721ApprovalEvent = {
  subId: 'sb-123',
  signature: approvalEventSignature,
  address: 'bob',
  operator: 'A',
  blockNumber: '1',
  transactionIndex: '0x0',
  transactionHash: '0x123',
  logIndex: '1',
  timestamp: '2020-01-01 00:00:00Z',
  data: {
    owner: IDENTITY,
    approved: 'B',
    tokenId: '5',
  },
  inputMethod: 'approveWithData',
  inputArgs: {
    tokenId: '5',
    data: '0x74657374',
    to: 'B',
  },
  inputSigner: IDENTITY,
};

const mockApprovalForAllEvent: ApprovalForAllEvent = {
  subId: 'sb-123',
  signature: approvalForAllEventSignature,
  address: 'bob',
  operator: 'A',
  blockNumber: '1',
  transactionIndex: '0x0',
  transactionHash: '0x123',
  logIndex: '1',
  timestamp: '2020-01-01 00:00:00Z',
  data: {
    owner: IDENTITY,
    operator: 'B',
    approved: true,
  },
  inputMethod: 'approveWithData',
  inputArgs: {
    approved: true,
    data: '0x74657374',
    operator: 'B',
  },
  inputSigner: IDENTITY,
};

export default (context: TestContext) => {
  it('ERC20 token mint event', async () => {
    context.eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: packSubscriptionName(ERC20_POOL_ID, '', 'default'),
    });

    const mockMintWebSocketMessage: WebSocketMessage = {
      event: 'token-mint',
      data: <TokenMintEvent>{
        id: '000000000001/000000/000001',
        poolData: 'default',
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

    await context.server
      .ws('/api/ws')
      .sendJson({
        type: 'start',
        namespace: 'ns1',
      })
      .exec(async () => {
        await context.connected;
        expect(context.eventHandler).toBeDefined();
        context.eventHandler({ events: [mockERC20MintTransferEvent], batchNumber: 12345 });
      })
      .expectJson(message => {
        expect(message.event).toEqual('started');
        expect(message.data.namespace).toEqual('ns1');
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        expect(message.event).toEqual('batch');
        expect(message.data.events).toHaveLength(1);
        expect(message.data.events[0]).toEqual(mockMintWebSocketMessage);
        return true;
      })
      .close();
  });

  it('ERC20 token mint event with old locator', async () => {
    context.eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name:
        TOPIC +
        ':' +
        `address=${CONTRACT_ADDRESS}&standard=${ERC20_STANDARD}&type=${TokenType.FUNGIBLE}`,
    });

    const mockMintWebSocketMessage: WebSocketMessage = {
      event: 'token-mint',
      data: <TokenMintEvent>{
        id: '000000000001/000000/000001',
        poolData: undefined,
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

    await context.server
      .ws('/api/ws')
      .sendJson({
        type: 'start',
        namespace: 'ns1',
      })
      .exec(async () => {
        await context.connected;
        expect(context.eventHandler).toBeDefined();
        context.eventHandler({ events: [mockERC20MintTransferEvent] });
      })
      .expectJson(message => {
        expect(message.event).toEqual('started');
        expect(message.data.namespace).toEqual('ns1');
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        expect(message.event).toEqual('batch');
        expect(message.data.events).toHaveLength(1);
        expect(message.data.events[0]).toEqual(mockMintWebSocketMessage);
        return true;
      })
      .close();
  });

  it('ERC721 token mint event', async () => {
    context.eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: packSubscriptionName(ERC721_POOL_ID, '', 'default'),
    });

    const baseUriResponse: EthConnectReturn = {
      output: ERC721_BASE_URI,
    };

    context.http.post = jest.fn(() => new FakeObservable(baseUriResponse));

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
        poolData: 'default',
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

    await context.server
      .ws('/api/ws')
      .sendJson({
        type: 'start',
        namespace: 'ns1',
      })
      .exec(async () => {
        await context.connected;
        expect(context.eventHandler).toBeDefined();
        context.eventHandler({ events: [mockERC721MintTransferEvent] });
      })
      .expectJson(message => {
        expect(message.event).toEqual('started');
        expect(message.data.namespace).toEqual('ns1');
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        expect(message.event).toEqual('batch');
        expect(message.data.events).toHaveLength(1);
        expect(message.data.events[0]).toEqual(mockMintWebSocketMessage);
        return true;
      })
      .close();
  });

  it('ERC20 token transfer event', async () => {
    context.eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: packSubscriptionName(ERC20_POOL_ID, '', 'default'),
    });

    const mockTransferWebSocketMessage: WebSocketMessage = {
      event: 'token-transfer',
      data: <TokenTransferEvent>{
        id: '000000000001/000000/000001',
        poolData: 'default',
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

    await context.server
      .ws('/api/ws')
      .sendJson({
        type: 'start',
        namespace: 'ns1',
      })
      .exec(async () => {
        await context.connected;
        expect(context.eventHandler).toBeDefined();
        context.eventHandler({ events: [mockERC20TransferEvent] });
      })
      .expectJson(message => {
        expect(message.event).toEqual('started');
        expect(message.data.namespace).toEqual('ns1');
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        expect(message.event).toEqual('batch');
        expect(message.data.events).toHaveLength(1);
        expect(message.data.events[0]).toEqual(mockTransferWebSocketMessage);
        return true;
      })
      .close();
  });

  it('ERC721 token transfer event', async () => {
    context.eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: packSubscriptionName(ERC721_POOL_ID, '', 'default'),
    });

    const baseUriResponse: EthConnectReturn = {
      output: ERC721_BASE_URI,
    };

    context.http.post = jest.fn(() => new FakeObservable(baseUriResponse));

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
        poolData: 'default',
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

    await context.server
      .ws('/api/ws')
      .sendJson({
        type: 'start',
        namespace: 'ns1',
      })
      .exec(async () => {
        await context.connected;
        expect(context.eventHandler).toBeDefined();
        context.eventHandler({ events: [mockERC721TransferEvent] });
      })
      .expectJson(message => {
        expect(message.event).toEqual('started');
        expect(message.data.namespace).toEqual('ns1');
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        expect(message.event).toEqual('batch');
        expect(message.data.events).toHaveLength(1);
        expect(message.data.events[0]).toEqual(mockTransferWebSocketMessage);
        return true;
      })
      .close();
  });

  it('ERC20 token burn event', async () => {
    context.eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: packSubscriptionName(ERC20_POOL_ID, '', 'default'),
    });

    const mockBurnWebSocketMessage: WebSocketMessage = {
      event: 'token-burn',
      data: <TokenBurnEvent>{
        id: '000000000001/000000/000001',
        poolData: 'default',
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

    await context.server
      .ws('/api/ws')
      .sendJson({
        type: 'start',
        namespace: 'ns1',
      })
      .exec(async () => {
        await context.connected;
        expect(context.eventHandler).toBeDefined();
        context.eventHandler({ events: [mockERC20BurnEvent] });
      })
      .expectJson(message => {
        expect(message.event).toEqual('started');
        expect(message.data.namespace).toEqual('ns1');
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        expect(message.event).toEqual('batch');
        expect(message.data.events).toHaveLength(1);
        expect(message.data.events[0]).toEqual(mockBurnWebSocketMessage);
        return true;
      })
      .close();
  });

  it('ERC721 token burn event', async () => {
    context.eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: packSubscriptionName(ERC721_POOL_ID, '', 'default'),
    });

    const baseUriResponse: EthConnectReturn = {
      output: '',
    };

    context.http.post = jest.fn(() => new FakeObservable(baseUriResponse));

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
        poolData: 'default',
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

    await context.server
      .ws('/api/ws')
      .sendJson({
        type: 'start',
        namespace: 'ns1',
      })
      .exec(async () => {
        await context.connected;
        expect(context.eventHandler).toBeDefined();
        context.eventHandler({ events: [mockERC721BurnEvent] });
      })
      .expectJson(message => {
        expect(message.event).toEqual('started');
        expect(message.data.namespace).toEqual('ns1');
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        expect(message.event).toEqual('batch');
        expect(message.data.events).toHaveLength(1);
        expect(message.data.events[0]).toEqual(mockBurnWebSocketMessage);
        return true;
      })
      .close();
  });

  it('ERC20 token approval event', async () => {
    context.eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: packSubscriptionName(ERC20_POOL_ID, '', 'default'),
    });

    const mockApprovalWebSocketMessage: WebSocketMessage = {
      event: 'token-approval',
      data: <TokenApprovalEvent>{
        id: '000000000001/000000/000001',
        poolData: 'default',
        poolLocator: ERC20_POOL_ID,
        signer: IDENTITY,
        operator: 'B',
        subject: IDENTITY + ':B',
        approved: true,
        data: 'test',
        info: {
          owner: IDENTITY,
          spender: 'B',
          value: '5',
        },
        blockchain: {
          id: '000000000001/000000/000001',
          name: 'Approval',
          location: 'address=bob',
          signature: approvalEventSignature,
          timestamp: '2020-01-01 00:00:00Z',
          output: {
            owner: IDENTITY,
            spender: 'B',
            value: '5',
          },
          info: {
            address: 'bob',
            blockNumber: '1',
            transactionIndex: '0x0',
            transactionHash: '0x123',
            logIndex: '1',
            signature: approvalEventSignature,
          },
        },
      },
    };

    await context.server
      .ws('/api/ws')
      .sendJson({
        type: 'start',
        namespace: 'ns1',
      })
      .exec(async () => {
        await context.connected;
        expect(context.eventHandler).toBeDefined();
        context.eventHandler({ events: [mockERC20ApprovalEvent] });
      })
      .expectJson(message => {
        expect(message.event).toEqual('started');
        expect(message.data.namespace).toEqual('ns1');
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        expect(message.event).toEqual('batch');
        expect(message.data.events).toHaveLength(1);
        expect(message.data.events[0]).toEqual(mockApprovalWebSocketMessage);
        return true;
      })
      .close();
  });

  it('ERC721 token approval event', async () => {
    context.eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: packSubscriptionName(ERC721_POOL_ID, '', 'default'),
    });

    const mockApprovalWebSocketMessage: WebSocketMessage = {
      event: 'token-approval',
      data: <TokenApprovalEvent>{
        id: '000000000001/000000/000001',
        poolData: 'default',
        poolLocator: ERC721_POOL_ID,
        signer: IDENTITY,
        operator: 'B',
        subject: '5',
        approved: true,
        data: 'test',
        info: {
          owner: IDENTITY,
          approved: 'B',
          tokenId: '5',
        },
        blockchain: {
          id: '000000000001/000000/000001',
          name: 'Approval',
          location: 'address=bob',
          signature: approvalEventSignature,
          timestamp: '2020-01-01 00:00:00Z',
          output: {
            owner: IDENTITY,
            approved: 'B',
            tokenId: '5',
          },
          info: {
            address: 'bob',
            blockNumber: '1',
            transactionIndex: '0x0',
            transactionHash: '0x123',
            logIndex: '1',
            signature: approvalEventSignature,
          },
        },
      },
    };

    await context.server
      .ws('/api/ws')
      .sendJson({
        type: 'start',
        namespace: 'ns1',
      })
      .exec(async () => {
        await context.connected;
        expect(context.eventHandler).toBeDefined();
        context.eventHandler({ events: [mockERC721ApprovalEvent] });
      })
      .expectJson(message => {
        expect(message.event).toEqual('started');
        expect(message.data.namespace).toEqual('ns1');
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        expect(message.event).toEqual('batch');
        expect(message.data.events).toHaveLength(1);
        expect(message.data.events[0]).toEqual(mockApprovalWebSocketMessage);
        return true;
      })
      .close();
  });

  it('ERC721 token approval for all event', async () => {
    context.eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: packSubscriptionName(ERC721_POOL_ID, '', 'default'),
    });

    const mockApprovalWebSocketMessage: WebSocketMessage = {
      event: 'token-approval',
      data: <TokenApprovalEvent>{
        id: '000000000001/000000/000001',
        poolData: 'default',
        poolLocator: ERC721_POOL_ID,
        signer: IDENTITY,
        operator: 'B',
        subject: IDENTITY + ':B',
        approved: true,
        data: 'test',
        info: {
          owner: IDENTITY,
          operator: 'B',
          approved: true,
        },
        blockchain: {
          id: '000000000001/000000/000001',
          name: 'ApprovalForAll',
          location: 'address=bob',
          signature: approvalForAllEventSignature,
          timestamp: '2020-01-01 00:00:00Z',
          output: {
            owner: IDENTITY,
            operator: 'B',
            approved: true,
          },
          info: {
            address: 'bob',
            blockNumber: '1',
            transactionIndex: '0x0',
            transactionHash: '0x123',
            logIndex: '1',
            signature: approvalForAllEventSignature,
          },
        },
      },
    };

    await context.server
      .ws('/api/ws')
      .sendJson({
        type: 'start',
        namespace: 'ns1',
      })
      .exec(async () => {
        await context.connected;
        expect(context.eventHandler).toBeDefined();
        context.eventHandler({ events: [mockApprovalForAllEvent] });
      })
      .expectJson(message => {
        expect(message.event).toEqual('started');
        expect(message.data.namespace).toEqual('ns1');
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        expect(message.event).toEqual('batch');
        expect(message.data.events).toHaveLength(1);
        expect(message.data.events[0]).toEqual(mockApprovalWebSocketMessage);
        return true;
      })
      .close();
  });

  it('Success receipt', () => {
    return context.server
      .ws('/api/ws')
      .sendJson({
        type: 'start',
        namespace: 'ns1',
      })
      .exec(async () => {
        await context.connected;
        expect(context.receiptHandler).toBeDefined();
        context.receiptHandler(<EventStreamReply>{
          headers: {
            requestId: '1',
            type: 'TransactionSuccess',
          },
        });
      })
      .expectJson(message => {
        expect(message).toMatchObject(<WebSocketMessage>{
          event: 'receipt',
          data: <EventStreamReply>{
            headers: {
              requestId: '1',
              type: 'TransactionSuccess',
            },
          },
        });
        return true;
      })
      .close();
  });

  it('Error receipt', () => {
    return context.server
      .ws('/api/ws')
      .sendJson({
        type: 'start',
        namespace: 'ns1',
      })
      .exec(async () => {
        await context.connected;
        expect(context.receiptHandler).toBeDefined();
        context.receiptHandler(<EventStreamReply>{
          headers: {
            requestId: '1',
            type: 'Error',
          },
          errorMessage: 'Failed',
        });
      })
      .expectJson(message => {
        expect(message).toMatchObject(<WebSocketMessage>{
          event: 'receipt',
          data: <EventStreamReply>{
            headers: {
              requestId: '1',
              type: 'Error',
            },
            errorMessage: 'Failed',
          },
        });
        return true;
      })
      .close();
  });

  it('Disconnect and reconnect', async () => {
    context.eventstream.getSubscription.mockReturnValueOnce(<EventStreamSubscription>{
      name: packSubscriptionName(CONTRACT_ADDRESS, '', 'default'),
    });

    await context.server
      .ws('/api/ws')
      .sendJson({
        type: 'start',
        namespace: 'ns1',
      })
      .exec(async () => {
        await context.connected;
        expect(context.eventHandler).toBeDefined();
        context.eventHandler({ events: [mockERC20MintTransferEvent] });
      })
      .expectJson(message => {
        expect(message.event).toEqual('started');
        expect(message.data.namespace).toEqual('ns1');
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        expect(message.event).toEqual('batch');
        expect(message.data.events).toHaveLength(1);
        expect(message.data.events[0].event).toEqual('token-mint');
        return true;
      })
      .close();

    context.resetConnectedPromise();

    await context.server
      .ws('/api/ws')
      .sendJson({
        type: 'start',
        namespace: 'ns1',
      })
      .exec(async () => {
        await context.connected;
        expect(context.eventHandler).toBeDefined();
        context.eventHandler({ events: [mockERC20MintTransferEvent] });
      })
      .expectJson(message => {
        expect(message.event).toEqual('started');
        expect(message.data.namespace).toEqual('ns1');
      })
      .expectJson(message => {
        expect(message.id).toBeDefined();
        expect(message.event).toEqual('batch');
        expect(message.data.events).toHaveLength(1);
        expect(message.data.events[0].event).toEqual('token-mint');
        return true;
      })
      .close();
  });
};
