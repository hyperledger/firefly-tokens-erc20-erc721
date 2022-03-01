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
import { Observer } from 'rxjs';
import ERC20NoDataABI from '../../solidity/build/contracts/ERC20NoData.json';
import ERC20WithDataABI from '../../solidity/build/contracts/ERC20WithData.json';
import ERC721NoDataABI from '../../solidity/build/contracts/ERC721NoData.json';
import ERC721WithDataABI from '../../solidity/build/contracts/ERC721WithData.json';
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
  EthConnectMsgRequest,
  IAbiMethod,
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
const ERC20_NO_DATA_STANDARD = 'ERC20NoData';
const ERC20_NO_DATA_POOL_ID = `address=${CONTRACT_ADDRESS}&standard=${ERC20_NO_DATA_STANDARD}&type=${TokenType.FUNGIBLE}`;
const ERC20_WITH_DATA_STANDARD = 'ERC20WithData';
const ERC20_WITH_DATA_POOL_ID = `address=${CONTRACT_ADDRESS}&standard=${ERC20_WITH_DATA_STANDARD}&type=${TokenType.FUNGIBLE}`;
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
const TRANSFER = 'Transfer';

const standardAbiMap = {
  ERC20NoData: ERC20NoDataABI.abi as IAbiMethod[],
  ERC20WithData: ERC20WithDataABI.abi as IAbiMethod[],
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

  describe('ERC20NoData', () => {
    it('should return ERC20NoData pool details successfully', () => {
      const request: TokenPool = {
        type: TokenType.FUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS, withData: false },
        name: NAME,
        symbol: SYMBOL,
      };

      expect(service.createPool(request)).toEqual({
        data: `{"tx":${TX}}`,
        poolId: ERC20_NO_DATA_POOL_ID,
        standard: ERC20_NO_DATA_STANDARD,
        timestamp: expect.any(String),
        type: 'fungible',
      } as TokenPoolEvent);
    });

    it('should activate ERC20NoData pool correctly and return correct values', async () => {
      const request: TokenPoolActivate = {
        poolId: ERC20_NO_DATA_POOL_ID,
      };

      const mockEventStream: EventStream = {
        id: 'es-4297d77c-0c33-49dc-4e5b-617e0b68fbab',
        name: 'token',
      };

      const response: TokenPoolEvent = {
        poolId: ERC20_NO_DATA_POOL_ID,
        standard: ERC20_NO_DATA_STANDARD,
        timestamp: expect.any(String),
        type: TokenType.FUNGIBLE,
      };

      eventstream.createOrUpdateStream = jest.fn(() => mockEventStream);
      eventstream.getOrCreateSubscription = jest.fn(() => new FakeObservable(undefined));
      await expect(service.activatePool(request)).resolves.toEqual(response);
      expect(eventstream.getOrCreateSubscription).toHaveBeenCalledWith(
        BASE_URL,
        standardAbiMap.ERC20NoData.find(abi => abi.name === TRANSFER) as IAbiMethod,
        'es-4297d77c-0c33-49dc-4e5b-617e0b68fbab',
        'Transfer',
        `${TOPIC}:${ERC20_NO_DATA_POOL_ID}:${TRANSFER}`,
        CONTRACT_ADDRESS,
        standardAbiMap.ERC20NoData.filter(
          abi =>
            abi.name === MINT_NO_DATA ||
            abi.name === TRANSFER_NO_DATA ||
            abi.name === BURN_NO_DATA ||
            abi.name === TRANSFER,
        ) as IAbiMethod[],
        '0',
      );
    });

    it('should mint ERC20NoData token with correct abi and inputs', async () => {
      const request: TokenMint = {
        amount: '20',
        signer: IDENTITY,
        poolId: ERC20_NO_DATA_POOL_ID,
        to: '0x123',
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: standardAbiMap.ERC20NoData.find(abi => abi.name === MINT_NO_DATA) as IAbiMethod,
        params: ['0x123', '20'],
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

    it('should transfer ERC20NoData token with correct abi and inputs', async () => {
      const request: TokenTransfer = {
        amount: '20',
        signer: IDENTITY,
        poolId: ERC20_NO_DATA_POOL_ID,
        from: IDENTITY,
        to: '0x123',
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: standardAbiMap.ERC20NoData.find(abi => abi.name === TRANSFER_NO_DATA) as IAbiMethod,
        params: [IDENTITY, '0x123', '20'],
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

    it('should burn ERC20NoData token with correct abi and inputs', async () => {
      const request: TokenBurn = {
        amount: '20',
        signer: IDENTITY,
        poolId: ERC20_NO_DATA_POOL_ID,
        from: IDENTITY,
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: standardAbiMap.ERC20NoData.find(abi => abi.name === BURN_NO_DATA) as IAbiMethod,
        params: [IDENTITY, '20'],
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
  });

  describe('ERC20WithData', () => {
    it('should return ERC20WithData pool details successfully  - implicit withData config', () => {
      const request: TokenPool = {
        type: TokenType.FUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS },
        name: NAME,
        symbol: SYMBOL,
      };

      expect(service.createPool(request)).toEqual({
        data: `{"tx":${TX}}`,
        poolId: ERC20_WITH_DATA_POOL_ID,
        standard: ERC20_WITH_DATA_STANDARD,
        timestamp: expect.any(String),
        type: 'fungible',
      } as TokenPoolEvent);
    });

    it('should return ERC20WithData pool details successfully - explicit withData config', () => {
      const request: TokenPool = {
        type: TokenType.FUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS, withData: true },
        name: NAME,
        symbol: SYMBOL,
      };

      expect(service.createPool(request)).toEqual({
        data: `{"tx":${TX}}`,
        poolId: ERC20_WITH_DATA_POOL_ID,
        standard: ERC20_WITH_DATA_STANDARD,
        timestamp: expect.any(String),
        type: 'fungible',
      } as TokenPoolEvent);
    });

    it('should activate ERC20WithData pool correctly and return correct values', async () => {
      const request: TokenPoolActivate = {
        poolId: ERC20_WITH_DATA_POOL_ID,
      };

      const mockEventStream: EventStream = {
        id: 'es-4297d77c-0c33-49dc-4e5b-617e0b68fbab',
        name: 'token',
      };

      const response: TokenPoolEvent = {
        poolId: ERC20_WITH_DATA_POOL_ID,
        standard: ERC20_WITH_DATA_STANDARD,
        timestamp: expect.any(String),
        type: TokenType.FUNGIBLE,
      };

      eventstream.createOrUpdateStream = jest.fn(() => mockEventStream);
      eventstream.getOrCreateSubscription = jest.fn(() => new FakeObservable(undefined));
      await expect(service.activatePool(request)).resolves.toEqual(response);
      expect(eventstream.getOrCreateSubscription).toHaveBeenCalledWith(
        BASE_URL,
        standardAbiMap.ERC20WithData.find(abi => abi.name === TRANSFER) as IAbiMethod,
        'es-4297d77c-0c33-49dc-4e5b-617e0b68fbab',
        'Transfer',
        `${TOPIC}:${ERC20_WITH_DATA_POOL_ID}:${TRANSFER}`,
        CONTRACT_ADDRESS,
        standardAbiMap.ERC20WithData.filter(
          abi =>
            abi.name === MINT_WITH_DATA ||
            abi.name === TRANSFER_WITH_DATA ||
            abi.name === BURN_WITH_DATA ||
            abi.name === TRANSFER,
        ) as IAbiMethod[],
        '0',
      );
    });

    it('should mint ERC20WithData token with correct abi and inputs', async () => {
      const request: TokenMint = {
        amount: '20',
        signer: IDENTITY,
        poolId: ERC20_WITH_DATA_POOL_ID,
        to: '0x123',
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: standardAbiMap.ERC20WithData.find(abi => abi.name === MINT_WITH_DATA) as IAbiMethod,
        params: ['0x123', '20', '0x00'],
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

    it('should transfer ERC20WithData token with correct abi and inputs', async () => {
      const request: TokenTransfer = {
        amount: '20',
        signer: IDENTITY,
        poolId: ERC20_WITH_DATA_POOL_ID,
        from: IDENTITY,
        to: '0x123',
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: standardAbiMap.ERC20WithData.find(
          abi => abi.name === TRANSFER_WITH_DATA,
        ) as IAbiMethod,
        params: [IDENTITY, '0x123', '20', '0x00'],
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

    it('should burn ERC20WithData token with correct abi and inputs', async () => {
      const request: TokenBurn = {
        amount: '20',
        signer: IDENTITY,
        poolId: ERC20_WITH_DATA_POOL_ID,
        from: IDENTITY,
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: standardAbiMap.ERC20WithData.find(abi => abi.name === BURN_WITH_DATA) as IAbiMethod,
        params: [IDENTITY, '20', '0x00'],
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
  });

  describe('ERC721NoData', () => {
    it('should return ERC721NoData pool details successfully', () => {
      const request: TokenPool = {
        type: TokenType.NONFUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS, withData: false },
        name: NAME,
        symbol: SYMBOL,
      };

      expect(service.createPool(request)).toEqual({
        data: `{"tx":${TX}}`,
        poolId: ERC721_NO_DATA_POOL_ID,
        standard: ERC721_NO_DATA_STANDARD,
        timestamp: expect.any(String),
        type: 'nonfungible',
      } as TokenPoolEvent);
    });

    it('should activate ERC721NoData pool correctly and return correct values', async () => {
      const request: TokenPoolActivate = {
        poolId: ERC721_NO_DATA_POOL_ID,
      };

      const mockEventStream: EventStream = {
        id: 'es-4297d77c-0c33-49dc-4e5b-617e0b68fbab',
        name: 'token',
      };

      const response: TokenPoolEvent = {
        poolId: ERC721_NO_DATA_POOL_ID,
        standard: ERC721_NO_DATA_STANDARD,
        timestamp: expect.any(String),
        type: TokenType.NONFUNGIBLE,
      };

      eventstream.createOrUpdateStream = jest.fn(() => mockEventStream);
      eventstream.getOrCreateSubscription = jest.fn(() => new FakeObservable(undefined));
      await expect(service.activatePool(request)).resolves.toEqual(response);
      expect(eventstream.getOrCreateSubscription).toHaveBeenCalledWith(
        BASE_URL,
        standardAbiMap.ERC721NoData.find(abi => abi.name === TRANSFER) as IAbiMethod,
        'es-4297d77c-0c33-49dc-4e5b-617e0b68fbab',
        'Transfer',
        `${TOPIC}:${ERC721_NO_DATA_POOL_ID}:${TRANSFER}`,
        CONTRACT_ADDRESS,
        standardAbiMap.ERC721NoData.filter(
          abi =>
            abi.name === MINT_NO_DATA ||
            abi.name === TRANSFER_NO_DATA ||
            abi.name === BURN_NO_DATA ||
            abi.name === TRANSFER,
        ) as IAbiMethod[],
        '0',
      );
    });

    it('should not mint ERC721NoData token due to invalid amount', async () => {
      const request: TokenMint = {
        amount: '2',
        tokenIndex: '721',
        signer: IDENTITY,
        poolId: ERC721_NO_DATA_POOL_ID,
        to: '0x123',
      };
      await expect(service.mint(request)).rejects.toThrowError(
        new HttpException('Amount for nonfungible tokens must be 1', HttpStatus.BAD_REQUEST),
      );
    });

    it('should mint ERC721NoData token with correct abi and inputs', async () => {
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
      await expect(service.mint(request)).resolves.toEqual({
        id: 'responseId',
      } as AsyncResponse);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });

    it('should transfer ERC721NoData token with correct abi and inputs', async () => {
      const request: TokenTransfer = {
        tokenIndex: '721',
        signer: IDENTITY,
        poolId: ERC721_NO_DATA_POOL_ID,
        from: IDENTITY,
        to: '0x123',
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
      await expect(service.transfer(request)).resolves.toEqual({
        id: 'responseId',
      } as AsyncResponse);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });

    it('should burn ERC721NoData token with correct abi and inputs', async () => {
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
      await expect(service.burn(request)).resolves.toEqual({
        id: 'responseId',
      } as AsyncResponse);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });
  });

  describe('ERC721WithData', () => {
    it('should return ERC721WithData pool details successfully - implicit withData config', () => {
      const request: TokenPool = {
        type: TokenType.NONFUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS },
        name: NAME,
        symbol: SYMBOL,
      };

      expect(service.createPool(request)).toEqual({
        data: `{"tx":${TX}}`,
        poolId: ERC721_WITH_DATA_POOL_ID,
        standard: ERC721_WITH_DATA_STANDARD,
        timestamp: expect.any(String),
        type: 'nonfungible',
      } as TokenPoolEvent);
    });

    it('should return ERC721WithData pool details successfully - explicit withData config', () => {
      const request: TokenPool = {
        type: TokenType.NONFUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS, withData: true },
        name: NAME,
        symbol: SYMBOL,
      };

      expect(service.createPool(request)).toEqual({
        data: `{"tx":${TX}}`,
        poolId: ERC721_WITH_DATA_POOL_ID,
        standard: ERC721_WITH_DATA_STANDARD,
        timestamp: expect.any(String),
        type: 'nonfungible',
      } as TokenPoolEvent);
    });

    it('should activate ERC721WithData pool correctly and return correct values', async () => {
      const request: TokenPoolActivate = {
        poolId: ERC721_WITH_DATA_POOL_ID,
      };

      const mockEventStream: EventStream = {
        id: 'es-4297d77c-0c33-49dc-4e5b-617e0b68fbab',
        name: 'token',
      };

      const response: TokenPoolEvent = {
        poolId: ERC721_WITH_DATA_POOL_ID,
        standard: ERC721_WITH_DATA_STANDARD,
        timestamp: expect.any(String),
        type: TokenType.NONFUNGIBLE,
      };

      eventstream.createOrUpdateStream = jest.fn(() => mockEventStream);
      eventstream.getOrCreateSubscription = jest.fn(() => new FakeObservable(undefined));
      await expect(service.activatePool(request)).resolves.toEqual(response);
      expect(eventstream.getOrCreateSubscription).toHaveBeenCalledWith(
        BASE_URL,
        standardAbiMap.ERC721WithData.find(abi => abi.name === TRANSFER) as IAbiMethod,
        'es-4297d77c-0c33-49dc-4e5b-617e0b68fbab',
        'Transfer',
        `${TOPIC}:${ERC721_WITH_DATA_POOL_ID}:${TRANSFER}`,
        CONTRACT_ADDRESS,
        standardAbiMap.ERC721WithData.filter(
          abi =>
            abi.name === MINT_WITH_DATA ||
            abi.name === TRANSFER_WITH_DATA ||
            abi.name === BURN_WITH_DATA ||
            abi.name === TRANSFER,
        ) as IAbiMethod[],
        '0',
      );
    });

    it('should not mint ERC721WithData token due to invalid amount', async () => {
      const request: TokenMint = {
        amount: '2',
        tokenIndex: '721',
        signer: IDENTITY,
        poolId: ERC721_WITH_DATA_POOL_ID,
        to: '0x123',
      };
      await expect(service.mint(request)).rejects.toThrowError(
        new HttpException('Amount for nonfungible tokens must be 1', HttpStatus.BAD_REQUEST),
      );
    });

    it('should mint ERC721WithData token with correct abi and inputs', async () => {
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
      await expect(service.mint(request)).resolves.toEqual({
        id: 'responseId',
      } as AsyncResponse);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });

    it('should transfer ERC721WithData token with correct abi and inputs', async () => {
      const request: TokenTransfer = {
        tokenIndex: '721',
        signer: IDENTITY,
        poolId: ERC721_WITH_DATA_POOL_ID,
        from: IDENTITY,
        to: '0x123',
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
      await expect(service.transfer(request)).resolves.toEqual({
        id: 'responseId',
      } as AsyncResponse);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });

    it('should burn ERC721WithData token with correct abi and inputs', async () => {
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
      await expect(service.burn(request)).resolves.toEqual({
        id: 'responseId',
      } as AsyncResponse);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, OPTIONS);
    });
  });

  describe('Miscellaneous', () => {
    it('should throw 404 exception if ABI method is not found when activating pool', async () => {
      const request: TokenPoolActivate = {
        poolId: 'address=0x123&standard=notAStandard&type=fungible',
      };
      await expect(service.activatePool(request)).rejects.toThrowError(
        new HttpException('ABI event not found', HttpStatus.NOT_FOUND),
      );
    });

    it('should throw 400 exception if poolID is malformed when activating pool', async () => {
      const request: TokenPoolActivate = {
        poolId: 'address=0x123&type=fungible',
      };
      await expect(service.activatePool(request)).rejects.toThrowError(
        new HttpException('Invalid Pool ID', HttpStatus.BAD_REQUEST),
      );
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
