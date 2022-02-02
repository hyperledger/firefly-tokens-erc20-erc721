// Copyright © 2022 Kaleido, Inc.
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

import { HttpService } from '@nestjs/axios';
import { HttpException, HttpStatus } from '@nestjs/common';
import { AxiosResponse } from '@nestjs/terminus/dist/health-indicator/http/axios.interfaces';
import { Test, TestingModule } from '@nestjs/testing';
import { Observer, of } from 'rxjs';
import {
  mockBalanceOfABI,
  mockBurnWithDataABI,
  mockMintWithDataABI,
  mockTransferEventABI,
  mockTransferWithDataABI,
} from '../../test/constants';
import {
  EventStream,
  EventStreamReply,
  EventStreamReplyHeaders,
} from '../event-stream/event-stream.interfaces';
import { EventStreamService } from '../event-stream/event-stream.service';
import { EventStreamProxyGateway } from '../eventstream-proxy/eventstream-proxy.gateway';
import {
  AsyncResponse,
  EthConnectAsyncResponse,
  EthConnectContractsResponse,
  EthConnectMsgRequest,
  TokenBalance,
  TokenBalanceQuery,
  TokenBurn,
  TokenMint,
  TokenPool,
  TokenPoolActivate,
  TokenPoolEvent,
  TokenTransfer,
  TokenType,
} from './tokens.interfaces';
import { TokensService } from './tokens.service';

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
const ERC20_STANDARD = 'ERC20WithData';
const POOL_ID = `address=${CONTRACT_ADDRESS}&standard=${ERC20_STANDARD}&type=${TokenType.FUNGIBLE}`;
const transferEvent = 'Transfer';

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

describe('TokensService', () => {
  let http: {
    get: ReturnType<typeof jest.fn>;
    post: ReturnType<typeof jest.fn>;
  };
  let service: TokensService;

  const eventstream = {
    createOrUpdateStream: jest.fn(),
    getOrCreateSubscription: jest.fn(),
  };

  beforeEach(async () => {
    http = {
      get: jest.fn(),
      post: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokensService,
        {
          provide: HttpService,
          useValue: {
            get: jest.fn(),
            post: jest.fn(),
          },
        },
        {
          provide: EventStreamService,
          useValue: { addListener: jest.fn() },
        },
        {
          provide: EventStreamProxyGateway,
          useValue: { addListener: jest.fn() },
        },
      ],
    })
      .overrideProvider(HttpService)
      .useValue(http)
      .overrideProvider(EventStreamService)
      .useValue(eventstream)
      .compile();

    service = module.get<TokensService>(TokensService);
    service.configure(BASE_URL, TOPIC, PREFIX, '', '');
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createPool()', () => {
    it('should return pool details successfully', () => {
      const request: TokenPool = {
        type: TokenType.FUNGIBLE,
        requestId: REQUEST,
        operator: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS },
        name: NAME,
        symbol: SYMBOL,
      };
      const response: EthConnectContractsResponse = {
        created: 'created',
        address: CONTRACT_ADDRESS,
        path: `contracts/${CONTRACT_ADDRESS}`,
        abi: '123',
        openapi: `contracts/${CONTRACT_ADDRESS}?swagger`,
        registeredAs: '',
      };

      jest.spyOn(http, 'get').mockReturnValue(
        of({
          data: response,
          status: 200,
          statusText: '',
          headers: undefined,
          config: undefined,
        } as AxiosResponse),
      );

      expect(service.createPool(request)).toEqual({
        data: `{"tx":${TX}}`,
        poolId: POOL_ID,
        standard: ERC20_STANDARD,
        timestamp: expect.any(String),
        type: 'fungible',
      } as TokenPoolEvent);
    });
  });

  describe('activatePool()', () => {
    it('should throw 404 exception if ABI method is not found', async () => {
      const request: TokenPoolActivate = {
        poolId: 'address=0x123&standard=notAStandard&type=fungible',
      };
      await expect(service.activatePool(request)).rejects.toThrowError(
        new HttpException('ABI event not found', HttpStatus.NOT_FOUND),
      );
    });

    it('should throw 400 exception if poolID is malformed', async () => {
      const request: TokenPoolActivate = {
        poolId: 'address=0x123&type=fungible',
      };
      await expect(service.activatePool(request)).rejects.toThrowError(
        new HttpException('Invalid Pool ID', HttpStatus.BAD_REQUEST),
      );
    });

    it('should activate pool correctly and return correct values', async () => {
      const request: TokenPoolActivate = {
        poolId: POOL_ID,
      };

      const mockEventStream: EventStream = {
        id: 'es-4297d77c-0c33-49dc-4e5b-617e0b68fbab',
        name: 'token',
      };

      const response: TokenPoolEvent = {
        poolId: POOL_ID,
        standard: ERC20_STANDARD,
        timestamp: expect.any(String),
        type: TokenType.FUNGIBLE,
      };

      eventstream.createOrUpdateStream = jest.fn(() => mockEventStream);
      eventstream.getOrCreateSubscription = jest.fn(() => new FakeObservable(undefined));
      await expect(service.activatePool(request)).resolves.toEqual(response);
      expect(eventstream.getOrCreateSubscription).toHaveBeenCalledWith(
        BASE_URL,
        mockTransferEventABI,
        'es-4297d77c-0c33-49dc-4e5b-617e0b68fbab',
        'Transfer',
        `${TOPIC}:${POOL_ID}:${transferEvent}`,
        CONTRACT_ADDRESS,
        [
          mockTransferEventABI,
          mockBalanceOfABI,
          mockMintWithDataABI,
          mockTransferWithDataABI,
          mockBurnWithDataABI,
        ],
        '0',
      );
    });
  });

  describe('mint/transfer/burn', () => {
    it('should mint ERC20 token with correct abi and inputs', async () => {
      const request: TokenMint = {
        amount: '10',
        operator: IDENTITY,
        poolId: POOL_ID,
        to: '0x123',
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: mockMintWithDataABI,
        params: ['0x123', '10', '0x00'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));
      await expect(service.mint(request)).resolves.toEqual({
        id: 'responseId',
      } as AsyncResponse);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });

    it('should transfer ERC20 token with correct abi and inputs', async () => {
      const request: TokenTransfer = {
        amount: '10',
        operator: IDENTITY,
        poolId: POOL_ID,
        from: IDENTITY,
        to: '0x123',
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: mockTransferWithDataABI,
        params: [IDENTITY, '0x123', '10', '0x00'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));
      await expect(service.transfer(request)).resolves.toEqual({
        id: 'responseId',
      } as AsyncResponse);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });

    it('should burn ERC20 token with correct abi and inputs', async () => {
      const request: TokenBurn = {
        amount: '10',
        operator: IDENTITY,
        poolId: POOL_ID,
        from: IDENTITY,
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: mockBurnWithDataABI,
        params: [IDENTITY, '10', '0x00'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));
      await expect(service.burn(request)).resolves.toEqual({
        id: 'responseId',
      } as AsyncResponse);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });

    it('should get balance of address with correct abi and inputs', async () => {
      const request: TokenBalanceQuery = {
        account: IDENTITY,
        poolId: POOL_ID,
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        to: CONTRACT_ADDRESS,
        method: mockBalanceOfABI,
        params: [IDENTITY],
      };

      const response: EthConnectAsyncResponse = {
        id: '10',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));
      await expect(service.balance(request)).resolves.toEqual({
        balance: '10',
      } as TokenBalance);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest);
    });
  });

  describe('getters for balance/receipt/operator', () => {
    it('should get balance of address with correct abi and inputs', async () => {
      const request: TokenBalanceQuery = {
        account: IDENTITY,
        poolId: POOL_ID,
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        to: CONTRACT_ADDRESS,
        method: mockBalanceOfABI,
        params: [IDENTITY],
      };

      const response: EthConnectAsyncResponse = {
        id: '10',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));
      await expect(service.balance(request)).resolves.toEqual({
        balance: '10',
      } as TokenBalance);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest);
    });

    it('should get receipt of id successfully', async () => {
      const response: EventStreamReply = {
        headers: {
          type: 'a type',
          requestId: 'requestId',
        } as EventStreamReplyHeaders,
        transactionHash: '0x1234',
      };

      http.get = jest.fn(() => new FakeObservable(response));
      await expect(service.getReceipt('requestId')).resolves.toEqual(response);
      expect(http.get).toHaveBeenCalledWith(`${BASE_URL}/reply/requestId`, {
        validateStatus: expect.any(Function),
      });
    });
  });
});
