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

import { HttpService } from '@nestjs/axios';
import { HttpException, HttpStatus } from '@nestjs/common';
import { AxiosResponse } from '@nestjs/terminus/dist/health-indicator/http/axios.interfaces';
import { Test, TestingModule } from '@nestjs/testing';
import { Observer } from 'rxjs';
import { newContext } from '../request-context/request-context.decorator';
import ERC20NoDataABI from '../abi/ERC20NoData.json';
import ERC20WithDataABI from '../abi/ERC20WithData.json';
import ERC721NoDataABI from '../abi/ERC721NoData.json';
import ERC721WithDataV1ABI from '../abi/ERC721WithDataV1b.json';
import ERC721WithDataV2ABI from '../abi/ERC721WithDataV2.json';
import {
  EventStream,
  EventStreamReply,
  EventStreamReplyHeaders,
} from '../event-stream/event-stream.interfaces';
import { EventStreamService } from '../event-stream/event-stream.service';
import { EventStreamProxyGateway } from '../eventstream-proxy/eventstream-proxy.gateway';
import { AbiMapperService } from './abimapper.service';
import { BlockchainConnectorService, RetryConfiguration } from './blockchain.service';
import {
  AsyncResponse,
  EthConnectAsyncResponse,
  EthConnectMsgRequest,
  EthConnectReturn,
  IAbiMethod,
  InterfaceFormat,
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
const TOPIC = 'tokentest';
const REQUEST = 'request123';
const TX = 'tx123';
const NAME = 'abcTest';
const SYMBOL = 'abc';

const ERC20_NO_DATA_SCHEMA = 'ERC20NoData';
const ERC20_NO_DATA_POOL_ID = `address=${CONTRACT_ADDRESS}&schema=${ERC20_NO_DATA_SCHEMA}&type=${TokenType.FUNGIBLE}`;
const ERC20_WITH_DATA_SCHEMA = 'ERC20WithData';
const ERC20_WITH_DATA_POOL_ID = `address=${CONTRACT_ADDRESS}&schema=${ERC20_WITH_DATA_SCHEMA}&type=${TokenType.FUNGIBLE}`;
const ERC721_NO_DATA_SCHEMA = 'ERC721NoData';
const ERC721_NO_DATA_POOL_ID = `address=${CONTRACT_ADDRESS}&schema=${ERC721_NO_DATA_SCHEMA}&type=${TokenType.NONFUNGIBLE}`;
const ERC721_WITH_DATA_SCHEMA = 'ERC721WithDataV2';
const ERC721_WITH_DATA_POOL_ID = `address=${CONTRACT_ADDRESS}&schema=${ERC721_WITH_DATA_SCHEMA}&type=${TokenType.NONFUNGIBLE}`;
const ERC721_WITH_DATA_V1_SCHEMA = 'ERC721WithData';
const ERC721_WITH_DATA_V1_POOL_ID = `address=${CONTRACT_ADDRESS}&schema=${ERC721_WITH_DATA_V1_SCHEMA}&type=${TokenType.NONFUNGIBLE}`;

const ERC20_MINT_NO_DATA = 'mint';
const ERC20_TRANSFER_NO_DATA = 'transfer';
const ERC20_TRANSFER_FROM_NO_DATA = 'transferFrom';
const ERC721_MINT_NO_DATA = 'safeMint';
const ERC721_TRANSFER_NO_DATA = 'safeTransferFrom';
const BURN_NO_DATA = 'burn';
const BURN_FROM_NO_DATA = 'burnFrom';
const APPROVE_NO_DATA = 'approve';
const APPROVE_ALL_NO_DATA = 'setApprovalForAll';

const MINT_WITH_DATA = 'mintWithData';
const MINT_WITH_URI = 'mintWithURI';
const TRANSFER_WITH_DATA = 'transferWithData';
const BURN_WITH_DATA = 'burnWithData';
const APPROVE_WITH_DATA = 'approveWithData';
const APPROVE_ALL_WITH_DATA = 'setApprovalForAllWithData';

const METHODS_NO_DATA = [
  APPROVE_NO_DATA,
  APPROVE_ALL_NO_DATA,
  BURN_NO_DATA,
  BURN_FROM_NO_DATA,
  ERC20_MINT_NO_DATA,
  ERC721_MINT_NO_DATA,
];

const METHODS_WITH_DATA = [
  APPROVE_WITH_DATA,
  APPROVE_ALL_WITH_DATA,
  APPROVE_NO_DATA,
  APPROVE_ALL_NO_DATA,
  BURN_WITH_DATA,
  MINT_WITH_URI,
  MINT_WITH_DATA,
  TRANSFER_WITH_DATA,
];

const TRANSFER_EVENT = 'Transfer';

const abiMethodMap = {
  ERC20NoData: ERC20NoDataABI.abi as IAbiMethod[],
  ERC20WithData: ERC20WithDataABI.abi as IAbiMethod[],
  ERC721NoData: ERC721NoDataABI.abi as IAbiMethod[],
  ERC721WithData: ERC721WithDataV2ABI.abi as IAbiMethod[],
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
  let blockchain: BlockchainConnectorService;

  const eventstream = {
    getStreams: jest.fn(),
    getSubscriptions: jest.fn(),
    createOrUpdateStream: jest.fn(),
    getOrCreateSubscription: jest.fn(),
  };
  eventstream.getStreams.mockReturnValue([]);

  const mockPoolQuery = (
    withData: boolean | undefined,
    withDecimals: boolean,
    getBaseUri: boolean,
  ) => {
    if (withData !== undefined) {
      http.post.mockReturnValueOnce(
        new FakeObservable(<EthConnectReturn>{
          output: withData,
        }),
      );
    }
    http.post
      .mockReturnValueOnce(
        new FakeObservable(<EthConnectReturn>{
          output: NAME,
        }),
      )
      .mockReturnValueOnce(
        new FakeObservable(<EthConnectReturn>{
          output: SYMBOL,
        }),
      );
    if (withDecimals) {
      http.post.mockReturnValueOnce(
        new FakeObservable(<EthConnectReturn>{
          output: '18',
        }),
      );
    }
    if (getBaseUri) {
      http.post.mockReturnValueOnce(
        new FakeObservable(<EthConnectReturn>{
          output: 'test',
        }),
      );
    }
  };

  const mockURIQuery = (withURI: boolean) => {
    http.post.mockReturnValueOnce(
      new FakeObservable(<EthConnectReturn>{
        output: withURI,
      }),
    );
  };

  const mockECONNErrors = (count: number) => {
    for (let i = 0; i < count; i++) {
      http.post.mockImplementationOnce(() => {
        throw new Error('connect ECONNREFUSED 10.1.2.3');
      });
    }
  };

  beforeEach(async () => {
    http = {
      get: jest.fn(),
      post: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokensService,
        AbiMapperService,
        BlockchainConnectorService,
        {
          provide: HttpService,
          useValue: {
            get: jest.fn(),
            post: jest.fn(),
          },
        },
        {
          provide: EventStreamService,
          useValue: eventstream,
        },
        {
          provide: EventStreamProxyGateway,
          useValue: {
            addConnectionListener: jest.fn(),
            addEventListener: jest.fn(),
            configure: jest.fn(),
          },
        },
      ],
    })
      .overrideProvider(HttpService)
      .useValue(http)
      .overrideProvider(EventStreamService)
      .useValue(eventstream)
      .compile();

    const blockchainRetryCfg: RetryConfiguration = {
      retryBackOffFactor: 2,
      retryBackOffLimit: 500,
      retryBackOffInitial: 50,
      retryCondition: '.*ECONN.*',
      retriesMax: 15,
    };

    service = module.get(TokensService);
    service.configure(BASE_URL, TOPIC, '');
    blockchain = module.get(BlockchainConnectorService);
    blockchain.configure(BASE_URL, '', '', '', [], blockchainRetryCfg);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('ERC20NoData', () => {
    it('should return ERC20NoData pool details successfully', async () => {
      const ctx = newContext();

      const request: TokenPool = {
        namespace: 'ns1',
        type: TokenType.FUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS },
        name: NAME,
        symbol: SYMBOL,
      };

      mockPoolQuery(false, true, false);

      await service.createPool(ctx, request).then(resp => {
        expect(resp).toEqual({
          namespace: 'ns1',
          data: `{"tx":${TX}}`,
          poolLocator: ERC20_NO_DATA_POOL_ID,
          standard: 'ERC20',
          interfaceFormat: InterfaceFormat.ABI,
          type: 'fungible',
          symbol: SYMBOL,
          decimals: 18,
          info: {
            name: NAME,
            address: CONTRACT_ADDRESS,
            schema: ERC20_NO_DATA_SCHEMA,
          },
        } as TokenPoolEvent);
      });
    });

    it('should activate ERC20NoData pool correctly and return correct values', async () => {
      const ctx = newContext();

      const request: TokenPoolActivate = {
        namespace: 'ns1',
        poolLocator: ERC20_NO_DATA_POOL_ID,
        poolData: 'ns1',
      };

      const mockEventStream: EventStream = {
        id: 'es-4297d77c-0c33-49dc-4e5b-617e0b68fbab',
        name: 'token',
      };

      const response: TokenPoolEvent = {
        namespace: 'ns1',
        poolData: 'ns1',
        poolLocator: ERC20_NO_DATA_POOL_ID,
        standard: 'ERC20',
        interfaceFormat: InterfaceFormat.ABI,
        type: TokenType.FUNGIBLE,
        symbol: SYMBOL,
        decimals: 18,
        info: {
          name: NAME,
          address: CONTRACT_ADDRESS,
          schema: ERC20_NO_DATA_SCHEMA,
        },
      };

      mockPoolQuery(undefined, true, false);

      eventstream.createOrUpdateStream = jest.fn(() => mockEventStream);
      eventstream.getOrCreateSubscription = jest.fn(() => new FakeObservable(undefined));

      await expect(service.activatePool(ctx, request)).resolves.toEqual(response);

      expect(eventstream.getOrCreateSubscription).toHaveBeenCalledWith(
        ctx,
        BASE_URL,
        ERC20NoDataABI.abi.find(abi => abi.name === TRANSFER_EVENT) as IAbiMethod,
        'es-4297d77c-0c33-49dc-4e5b-617e0b68fbab',
        `fft:${ERC20_NO_DATA_POOL_ID}:${TRANSFER_EVENT}:ns1`,
        CONTRACT_ADDRESS,
        [...METHODS_NO_DATA, ERC20_TRANSFER_NO_DATA, ERC20_TRANSFER_FROM_NO_DATA]
          .map(name => {
            return ERC20NoDataABI.abi.find(abi => abi.name === name);
          })
          .filter(abi => abi !== undefined),
        '0',
      );
    });

    it('should mint ERC20NoData token with correct abi and inputs', async () => {
      const ctx = newContext();
      const headers = {
        'x-firefly-request-id': ctx.requestId,
      };

      const request: TokenMint = {
        namespace: 'ns1',
        amount: '20',
        signer: IDENTITY,
        poolLocator: ERC20_NO_DATA_POOL_ID,
        to: '0x123',
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC20NoDataABI.abi.find(abi => abi.name === ERC20_MINT_NO_DATA) as IAbiMethod,
        params: ['0x123', '20'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));
      await expect(service.mint(ctx, request)).resolves.toEqual({
        id: 'responseId',
      } as AsyncResponse);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, { headers });
    });

    it('should transfer ERC20NoData token with correct abi and inputs', async () => {
      const ctx = newContext();
      const headers = {
        'x-firefly-request-id': ctx.requestId,
      };

      const request: TokenTransfer = {
        namespace: 'ns1',
        amount: '20',
        signer: IDENTITY,
        poolLocator: ERC20_NO_DATA_POOL_ID,
        from: IDENTITY,
        to: '0x123',
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC20NoDataABI.abi.find(abi => abi.name === ERC20_TRANSFER_NO_DATA) as IAbiMethod,
        params: ['0x123', '20'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));
      await expect(service.transfer(ctx, request)).resolves.toEqual({
        id: 'responseId',
      } as AsyncResponse);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, { headers });
    });

    it('should burn ERC20NoData token with correct abi and inputs', async () => {
      const ctx = newContext();
      const headers = {
        'x-firefly-request-id': ctx.requestId,
      };

      const request: TokenBurn = {
        namespace: 'ns1',
        amount: '20',
        signer: IDENTITY,
        poolLocator: ERC20_NO_DATA_POOL_ID,
        from: IDENTITY,
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC20NoDataABI.abi.find(abi => abi.name === BURN_NO_DATA) as IAbiMethod,
        params: ['20'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));
      await expect(service.burn(ctx, request)).resolves.toEqual({
        id: 'responseId',
      } as AsyncResponse);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, { headers });
    });
  });

  describe('ERC20WithData', () => {
    it('should return ERC20WithData pool details successfully  - implicit withData config', async () => {
      const ctx = newContext();

      const request: TokenPool = {
        namespace: 'ns1',
        type: TokenType.FUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS },
        name: NAME,
        symbol: SYMBOL,
      };

      mockPoolQuery(true, true, false);

      await service.createPool(ctx, request).then(resp => {
        expect(resp).toEqual({
          namespace: 'ns1',
          data: `{"tx":${TX}}`,
          poolLocator: ERC20_WITH_DATA_POOL_ID,
          standard: 'ERC20',
          interfaceFormat: InterfaceFormat.ABI,
          type: 'fungible',
          symbol: SYMBOL,
          decimals: 18,
          info: {
            name: NAME,
            address: CONTRACT_ADDRESS,
            schema: ERC20_WITH_DATA_SCHEMA,
          },
        } as TokenPoolEvent);
      });
    });

    it('should return ERC20WithData pool details successfully - explicit withData config', async () => {
      const ctx = newContext();

      const request: TokenPool = {
        namespace: 'ns1',
        type: TokenType.FUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS },
        name: NAME,
        symbol: SYMBOL,
      };

      mockPoolQuery(true, true, false);

      await service.createPool(ctx, request).then(resp => {
        expect(resp).toEqual({
          namespace: 'ns1',
          data: `{"tx":${TX}}`,
          poolLocator: ERC20_WITH_DATA_POOL_ID,
          standard: 'ERC20',
          interfaceFormat: InterfaceFormat.ABI,
          type: 'fungible',
          symbol: SYMBOL,
          decimals: 18,
          info: {
            name: NAME,
            address: CONTRACT_ADDRESS,
            schema: ERC20_WITH_DATA_SCHEMA,
          },
        } as TokenPoolEvent);
      });
    });

    it('should activate ERC20WithData pool correctly and return correct values', async () => {
      const ctx = newContext();

      const request: TokenPoolActivate = {
        namespace: 'ns1',
        poolLocator: ERC20_WITH_DATA_POOL_ID,
        poolData: 'ns1',
      };

      const mockEventStream: EventStream = {
        id: 'es-4297d77c-0c33-49dc-4e5b-617e0b68fbab',
        name: 'token',
      };

      const response: TokenPoolEvent = {
        namespace: 'ns1',
        poolData: 'ns1',
        poolLocator: ERC20_WITH_DATA_POOL_ID,
        standard: 'ERC20',
        interfaceFormat: InterfaceFormat.ABI,
        type: TokenType.FUNGIBLE,
        symbol: SYMBOL,
        decimals: 18,
        info: {
          name: NAME,
          address: CONTRACT_ADDRESS,
          schema: ERC20_WITH_DATA_SCHEMA,
        },
      };

      mockPoolQuery(undefined, true, false);

      eventstream.createOrUpdateStream = jest.fn(() => mockEventStream);
      eventstream.getOrCreateSubscription = jest.fn(() => new FakeObservable(undefined));

      await expect(service.activatePool(ctx, request)).resolves.toEqual(response);

      expect(eventstream.getOrCreateSubscription).toHaveBeenCalledWith(
        ctx,
        BASE_URL,
        abiMethodMap.ERC20WithData.find(abi => abi.name === TRANSFER_EVENT) as IAbiMethod,
        'es-4297d77c-0c33-49dc-4e5b-617e0b68fbab',
        `fft:${ERC20_WITH_DATA_POOL_ID}:${TRANSFER_EVENT}:ns1`,
        CONTRACT_ADDRESS,
        [...METHODS_WITH_DATA, ERC20_TRANSFER_NO_DATA, ERC20_TRANSFER_FROM_NO_DATA]
          .map(name => {
            return abiMethodMap.ERC20WithData.find(abi => abi.name === name);
          })
          .filter(abi => abi !== undefined),
        '0',
      );
    });

    it('should mint ERC20WithData token with correct abi and inputs', async () => {
      const ctx = newContext();
      const headers = {
        'x-firefly-request-id': ctx.requestId,
      };

      const request: TokenMint = {
        namespace: 'ns1',
        amount: '20',
        signer: IDENTITY,
        poolLocator: ERC20_WITH_DATA_POOL_ID,
        to: '0x123',
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC20WithDataABI.abi.find(abi => abi.name === MINT_WITH_DATA) as IAbiMethod,
        params: ['0x123', '20', '0x00'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));
      await expect(service.mint(ctx, request)).resolves.toEqual({
        id: 'responseId',
      } as AsyncResponse);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, { headers });
    });

    it('should transfer ERC20WithData token with correct abi and inputs', async () => {
      const ctx = newContext();
      const headers = {
        'x-firefly-request-id': ctx.requestId,
      };

      const request: TokenTransfer = {
        namespace: 'ns1',
        amount: '20',
        signer: IDENTITY,
        poolLocator: ERC20_WITH_DATA_POOL_ID,
        from: IDENTITY,
        to: '0x123',
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC20WithDataABI.abi.find(abi => abi.name === TRANSFER_WITH_DATA) as IAbiMethod,
        params: [IDENTITY, '0x123', '20', '0x00'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));
      await expect(service.transfer(ctx, request)).resolves.toEqual({
        id: 'responseId',
      } as AsyncResponse);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, { headers });
    });

    it('should burn ERC20WithData token with correct abi and inputs', async () => {
      const ctx = newContext();
      const headers = {
        'x-firefly-request-id': ctx.requestId,
      };

      const request: TokenBurn = {
        namespace: 'ns1',
        amount: '20',
        signer: IDENTITY,
        poolLocator: ERC20_WITH_DATA_POOL_ID,
        from: IDENTITY,
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC20WithDataABI.abi.find(abi => abi.name === BURN_WITH_DATA) as IAbiMethod,
        params: [IDENTITY, '20', '0x00'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));
      await expect(service.burn(ctx, request)).resolves.toEqual({
        id: 'responseId',
      } as AsyncResponse);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, { headers });
    });
  });

  describe('ERC721NoData', () => {
    const ctx = newContext();

    it('should return ERC721NoData pool details successfully', async () => {
      const request: TokenPool = {
        namespace: 'ns1',
        type: TokenType.NONFUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS },
        name: NAME,
        symbol: SYMBOL,
      };

      mockURIQuery(false);
      mockURIQuery(false);
      mockPoolQuery(false, false, true);

      await service.createPool(ctx, request).then(resp => {
        expect(resp).toEqual({
          namespace: 'ns1',
          data: `{"tx":${TX}}`,
          poolLocator: ERC721_NO_DATA_POOL_ID,
          standard: 'ERC721',
          interfaceFormat: InterfaceFormat.ABI,
          type: 'nonfungible',
          symbol: SYMBOL,
          decimals: 0,
          info: {
            name: NAME,
            address: CONTRACT_ADDRESS,
            schema: ERC721_NO_DATA_SCHEMA,
          },
        } as TokenPoolEvent);
      });
    });

    it('should activate ERC721NoData pool correctly and return correct values', async () => {
      const ctx = newContext();

      const request: TokenPoolActivate = {
        namespace: 'ns1',
        poolLocator: ERC721_NO_DATA_POOL_ID,
        poolData: 'ns1',
      };

      const mockEventStream: EventStream = {
        id: 'es-4297d77c-0c33-49dc-4e5b-617e0b68fbab',
        name: 'token',
      };

      const response: TokenPoolEvent = {
        namespace: 'ns1',
        poolData: 'ns1',
        poolLocator: ERC721_NO_DATA_POOL_ID,
        standard: 'ERC721',
        interfaceFormat: InterfaceFormat.ABI,
        type: TokenType.NONFUNGIBLE,
        symbol: SYMBOL,
        decimals: 0,
        info: {
          name: NAME,
          address: CONTRACT_ADDRESS,
          schema: ERC721_NO_DATA_SCHEMA,
        },
      };

      mockPoolQuery(undefined, false, false);

      eventstream.createOrUpdateStream = jest.fn(() => mockEventStream);
      eventstream.getOrCreateSubscription = jest.fn(() => new FakeObservable(undefined));

      await expect(service.activatePool(ctx, request)).resolves.toEqual(response);

      const methods: IAbiMethod[] = [];
      [...METHODS_NO_DATA, ERC721_TRANSFER_NO_DATA].forEach(name => {
        methods.push(...ERC721NoDataABI.abi.filter(abi => abi.name === name).reverse());
      });

      expect(eventstream.getOrCreateSubscription).toHaveBeenCalledWith(
        ctx,
        BASE_URL,
        abiMethodMap.ERC721NoData.find(abi => abi.name === TRANSFER_EVENT) as IAbiMethod,
        'es-4297d77c-0c33-49dc-4e5b-617e0b68fbab',
        `fft:${ERC721_NO_DATA_POOL_ID}:${TRANSFER_EVENT}:ns1`,
        CONTRACT_ADDRESS,
        methods,
        '0',
      );
    });

    it('should not mint ERC721NoData token due to invalid amount', async () => {
      const ctx = newContext();

      const request: TokenMint = {
        namespace: 'ns1',
        amount: '2',
        signer: IDENTITY,
        poolLocator: ERC721_NO_DATA_POOL_ID,
        to: '0x123',
      };
      await expect(service.mint(ctx, request)).rejects.toThrowError(
        new HttpException('Amount for nonfungible tokens must be 1', HttpStatus.BAD_REQUEST),
      );
    });

    it('should mint ERC721NoData token with correct abi and inputs', async () => {
      const ctx = newContext();
      const headers = {
        'x-firefly-request-id': ctx.requestId,
      };

      const request: TokenMint = {
        namespace: 'ns1',
        signer: IDENTITY,
        poolLocator: ERC721_NO_DATA_POOL_ID,
        to: '0x123',
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC721NoDataABI.abi.find(abi => abi.name === ERC721_MINT_NO_DATA) as IAbiMethod,
        params: ['0x123'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));
      await expect(service.mint(ctx, request)).resolves.toEqual({
        id: 'responseId',
      } as AsyncResponse);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, { headers });
    });

    it('should transfer ERC721NoData token with correct abi and inputs', async () => {
      const ctx = newContext();
      const headers = {
        'x-firefly-request-id': ctx.requestId,
      };

      const request: TokenTransfer = {
        namespace: 'ns1',
        tokenIndex: '721',
        signer: IDENTITY,
        poolLocator: ERC721_NO_DATA_POOL_ID,
        from: IDENTITY,
        to: '0x123',
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC721NoDataABI.abi.find(
          abi => abi.name === ERC721_TRANSFER_NO_DATA && abi.inputs.length === 4,
        ) as IAbiMethod,
        params: [IDENTITY, '0x123', '721', '0x00'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));
      await expect(service.transfer(ctx, request)).resolves.toEqual({
        id: 'responseId',
      } as AsyncResponse);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, { headers });
    });

    it('should burn ERC721NoData token with correct abi and inputs', async () => {
      const ctx = newContext();
      const headers = {
        'x-firefly-request-id': ctx.requestId,
      };

      const request: TokenBurn = {
        namespace: 'ns1',
        tokenIndex: '721',
        signer: IDENTITY,
        poolLocator: ERC721_NO_DATA_POOL_ID,
        from: IDENTITY,
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC721NoDataABI.abi.find(abi => abi.name === BURN_NO_DATA) as IAbiMethod,
        params: ['721'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));
      await expect(service.burn(ctx, request)).resolves.toEqual({
        id: 'responseId',
      } as AsyncResponse);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, { headers });
    });
  });

  describe('ERC721WithData', () => {
    const ctx = newContext();

    it('should return ERC721WithData pool details successfully - implicit withData config', async () => {
      const request: TokenPool = {
        namespace: 'ns1',
        type: TokenType.NONFUNGIBLE,
        requestId: REQUEST,
        signer: IDENTITY,
        data: `{"tx":${TX}}`,
        config: { address: CONTRACT_ADDRESS },
        name: NAME,
        symbol: SYMBOL,
      };

      mockURIQuery(true);
      mockPoolQuery(undefined, false, true);

      await service.createPool(ctx, request).then(resp => {
        expect(resp).toEqual({
          namespace: 'ns1',
          data: `{"tx":${TX}}`,
          poolLocator: ERC721_WITH_DATA_POOL_ID,
          standard: 'ERC721',
          interfaceFormat: InterfaceFormat.ABI,
          type: 'nonfungible',
          symbol: SYMBOL,
          decimals: 0,
          info: {
            name: NAME,
            address: CONTRACT_ADDRESS,
            schema: ERC721_WITH_DATA_SCHEMA,
          },
        } as TokenPoolEvent);
      });
    });

    it('should activate ERC721WithData pool correctly and return correct values', async () => {
      const ctx = newContext();

      const request: TokenPoolActivate = {
        namespace: 'ns1',
        poolLocator: ERC721_WITH_DATA_POOL_ID,
        poolData: 'ns1',
      };

      const mockEventStream: EventStream = {
        id: 'es-4297d77c-0c33-49dc-4e5b-617e0b68fbab',
        name: 'token',
      };

      const response: TokenPoolEvent = {
        namespace: 'ns1',
        poolData: 'ns1',
        poolLocator: ERC721_WITH_DATA_POOL_ID,
        standard: 'ERC721',
        interfaceFormat: InterfaceFormat.ABI,
        type: TokenType.NONFUNGIBLE,
        symbol: SYMBOL,
        decimals: 0,
        info: {
          name: NAME,
          address: CONTRACT_ADDRESS,
          schema: ERC721_WITH_DATA_SCHEMA,
        },
      };

      mockPoolQuery(undefined, false, true);

      eventstream.createOrUpdateStream = jest.fn(() => mockEventStream);
      eventstream.getOrCreateSubscription = jest.fn(() => new FakeObservable(undefined));

      await expect(service.activatePool(ctx, request)).resolves.toEqual(response);

      const methods: IAbiMethod[] = [];
      [...METHODS_WITH_DATA, ERC721_TRANSFER_NO_DATA].forEach(name => {
        methods.push(...ERC721WithDataV2ABI.abi.filter(abi => abi.name === name).reverse());
      });

      expect(eventstream.getOrCreateSubscription).toHaveBeenCalledWith(
        ctx,
        BASE_URL,
        ERC721WithDataV2ABI.abi.find(abi => abi.name === TRANSFER_EVENT) as IAbiMethod,
        'es-4297d77c-0c33-49dc-4e5b-617e0b68fbab',
        `fft:${ERC721_WITH_DATA_POOL_ID}:${TRANSFER_EVENT}:ns1`,
        CONTRACT_ADDRESS,
        methods,
        '0',
      );
    });

    it('should not mint ERC721WithData token due to invalid amount', async () => {
      const ctx = newContext();
      const request: TokenMint = {
        namespace: 'ns1',
        amount: '2',
        signer: IDENTITY,
        poolLocator: ERC721_WITH_DATA_POOL_ID,
        to: '0x123',
      };
      await expect(service.mint(ctx, request)).rejects.toThrowError(
        new HttpException('Amount for nonfungible tokens must be 1', HttpStatus.BAD_REQUEST),
      );
    });

    it('should mint ERC721WithData token with correct abi and inputs', async () => {
      const ctx = newContext();
      const headers = {
        'x-firefly-request-id': ctx.requestId,
      };

      const request: TokenMint = {
        namespace: 'ns1',
        tokenIndex: '721',
        signer: IDENTITY,
        poolLocator: ERC721_WITH_DATA_V1_POOL_ID,
        to: '0x123',
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC721WithDataV1ABI.abi.find(abi => abi.name === MINT_WITH_DATA) as IAbiMethod,
        params: ['0x123', '721', '0x00'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      mockURIQuery(false);
      http.post.mockReturnValueOnce(new FakeObservable(response));

      await expect(service.mint(ctx, request)).resolves.toEqual({
        id: 'responseId',
      } as AsyncResponse);

      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, { headers });
    });

    it('should mint ERC721WithData token with correct abi, custom uri, and inputs', async () => {
      const ctx = newContext();
      const headers = {
        'x-firefly-request-id': ctx.requestId,
      };

      const request: TokenMint = {
        namespace: 'ns1',
        tokenIndex: '721',
        signer: IDENTITY,
        poolLocator: ERC721_WITH_DATA_V1_POOL_ID,
        to: '0x123',
        uri: 'ipfs://CID',
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC721WithDataV1ABI.abi.find(abi => abi.name === MINT_WITH_URI) as IAbiMethod,
        params: ['0x123', '721', '0x00', 'ipfs://CID'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      mockURIQuery(true);
      http.post.mockReturnValueOnce(new FakeObservable(response));

      await expect(service.mint(ctx, request)).resolves.toEqual({
        id: 'responseId',
      } as AsyncResponse);

      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, { headers });
    });

    it('should mint ERC721WithData token with correct abi, custom uri, and inputs after 6 ECONNREFUSED retries', async () => {
      const ctx = newContext();
      const headers = {
        'x-firefly-request-id': ctx.requestId,
      };

      const request: TokenMint = {
        namespace: 'ns1',
        tokenIndex: '721',
        signer: IDENTITY,
        poolLocator: ERC721_WITH_DATA_V1_POOL_ID,
        to: '0x123',
        uri: 'ipfs://CID',
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC721WithDataV1ABI.abi.find(abi => abi.name === MINT_WITH_URI) as IAbiMethod,
        params: ['0x123', '721', '0x00', 'ipfs://CID'],
      };

      http.post.mockReturnValueOnce(
        new FakeObservable(<EthConnectReturn>{
          output: true,
        }),
      );
      mockECONNErrors(6);
      http.post.mockReturnValueOnce(new FakeObservable(response));

      await service.mint(ctx, request);

      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, { headers });
      expect(http.post).toHaveBeenCalledTimes(8); // Expect initial submit OK, 6 ECONN errors, final call OK = 8 POSTs
    });

    it('should mint ERC721WithData token with correct abi, custom uri, auto-indexing, and inputs', async () => {
      const ctx = newContext();
      const headers = {
        'x-firefly-request-id': ctx.requestId,
      };

      const request: TokenMint = {
        namespace: 'ns1',
        signer: IDENTITY,
        poolLocator: ERC721_WITH_DATA_POOL_ID,
        to: '0x123',
        uri: 'ipfs://CID',
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC721WithDataV2ABI.abi.find(abi => abi.name === MINT_WITH_URI) as IAbiMethod,
        params: ['0x123', '0x00', 'ipfs://CID'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post.mockReturnValueOnce(new FakeObservable(response));

      await expect(service.mint(ctx, request)).resolves.toEqual({
        id: 'responseId',
      } as AsyncResponse);

      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, { headers });
    });

    it('should transfer ERC721WithData token with correct abi and inputs', async () => {
      const ctx = newContext();
      const headers = {
        'x-firefly-request-id': ctx.requestId,
      };

      const request: TokenTransfer = {
        namespace: 'ns1',
        tokenIndex: '721',
        signer: IDENTITY,
        poolLocator: ERC721_WITH_DATA_POOL_ID,
        from: IDENTITY,
        to: '0x123',
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: ERC721WithDataV2ABI.abi.find(abi => abi.name === TRANSFER_WITH_DATA) as IAbiMethod,
        params: [IDENTITY, '0x123', '721', '0x00'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));
      await expect(service.transfer(ctx, request)).resolves.toEqual({
        id: 'responseId',
      } as AsyncResponse);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, { headers });
    });

    it('should burn ERC721WithData token with correct abi and inputs', async () => {
      const ctx = newContext();
      const headers = {
        'x-firefly-request-id': ctx.requestId,
      };

      const request: TokenBurn = {
        namespace: 'ns1',
        tokenIndex: '721',
        signer: IDENTITY,
        poolLocator: ERC721_WITH_DATA_POOL_ID,
        from: IDENTITY,
      };

      const mockEthConnectRequest: EthConnectMsgRequest = {
        headers: {
          type: 'SendTransaction',
        },
        from: IDENTITY,
        to: CONTRACT_ADDRESS,
        method: abiMethodMap.ERC721WithData.find(abi => abi.name === BURN_WITH_DATA) as IAbiMethod,
        params: [IDENTITY, '721', '0x00'],
      };

      const response: EthConnectAsyncResponse = {
        id: 'responseId',
        sent: true,
      };

      http.post = jest.fn(() => new FakeObservable(response));
      await expect(service.burn(ctx, request)).resolves.toEqual({
        id: 'responseId',
      } as AsyncResponse);
      expect(http.post).toHaveBeenCalledWith(BASE_URL, mockEthConnectRequest, { headers });
    });
  });

  describe('Miscellaneous', () => {
    it('should throw 404 exception if ABI method is not found when activating pool', async () => {
      const ctx = newContext();

      const request: TokenPoolActivate = {
        namespace: 'ns1',
        poolLocator: 'address=0x123&standard=notAStandard&type=fungible',
        poolData: 'ns1',
      };
      await expect(service.activatePool(ctx, request)).rejects.toThrowError(
        new HttpException('Unknown schema: notAStandard', HttpStatus.BAD_REQUEST),
      );
    });

    it('should throw 400 exception if locator is malformed when activating pool', async () => {
      const ctx = newContext();

      const request: TokenPoolActivate = {
        namespace: 'ns1',
        poolLocator: 'address=0x123&type=fungible',
        poolData: 'ns1',
      };
      await expect(service.activatePool(ctx, request)).rejects.toThrowError(
        new HttpException('Invalid pool locator', HttpStatus.BAD_REQUEST),
      );
    });

    it('should get receipt of id successfully', async () => {
      const ctx = newContext();
      const headers = {
        'x-firefly-request-id': ctx.requestId,
      };

      const response: EventStreamReply = {
        headers: {
          type: 'a type',
          requestId: 'requestId',
        } as EventStreamReplyHeaders,
        transactionHash: '0x1234',
      };

      http.get = jest.fn(() => new FakeObservable(response));
      await expect(blockchain.getReceipt(ctx, 'requestId')).resolves.toEqual(response);
      expect(http.get).toHaveBeenCalledWith(`${BASE_URL}/reply/requestId`, {
        headers,
        validateStatus: expect.any(Function),
      });
    });
  });

  describe('Subscription migration', () => {
    it('should not migrate if no subscriptions exists', async () => {
      const ctx = newContext();

      service.topic = 'tokens';
      eventstream.getStreams.mockReturnValueOnce([{ id: 'stream1', name: 'tokens' }]);
      eventstream.getSubscriptions.mockReturnValueOnce([]);
      expect(await service.migrationCheck(ctx)).toBe(false);
    });

    it('should migrate if any event subscriptions are missing', async () => {
      const ctx = newContext();

      service.topic = 'tokens';
      eventstream.getStreams.mockReturnValueOnce([{ id: 'stream1', name: 'tokens' }]);
      eventstream.getSubscriptions.mockReturnValueOnce([
        {
          stream: 'stream1',
          name: 'fft:address=0x123&schema=ERC20WithData&type=fungible:Transfer',
        },
      ]);
      expect(await service.migrationCheck(ctx)).toBe(true);
    });

    it('should not migrate if all event subscriptions exist', async () => {
      const ctx = newContext();

      service.topic = 'tokens';
      eventstream.getStreams.mockReturnValueOnce([{ id: 'stream1', name: 'tokens' }]);
      eventstream.getSubscriptions.mockReturnValueOnce([
        {
          stream: 'stream1',
          name: 'fft:address=0x123&schema=ERC20WithData&type=fungible:Transfer',
        },
        {
          stream: 'stream1',
          name: 'fft:address=0x123&schema=ERC20WithData&type=fungible:Approval',
        },
      ]);
      expect(await service.migrationCheck(ctx)).toBe(false);
    });
  });
});
