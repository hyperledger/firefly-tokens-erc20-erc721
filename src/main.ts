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

import { ShutdownSignal, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { version as API_VERSION } from '../package.json';
import { AppModule } from './app.module';
import { EventStreamReply } from './event-stream/event-stream.interfaces';
import { EventStreamService } from './event-stream/event-stream.service';
import { requestIDMiddleware } from './request-context/request-id.middleware';
import { RequestLoggingInterceptor } from './request-logging.interceptor';
import { BlockchainConnectorService, RetryConfiguration } from './tokens/blockchain.service';
import {
  TokenApprovalEvent,
  TokenBurnEvent,
  TokenMintEvent,
  TokenPoolEvent,
  TokenTransferEvent,
} from './tokens/tokens.interfaces';
import { TokensService } from './tokens/tokens.service';
import { newContext } from './request-context/request-context.decorator';
import { AbiMapperService } from './tokens/abimapper.service';
import { getNestOptions } from './utils';

const API_DESCRIPTION = `
<p>All POST APIs are asynchronous. Listen for websocket notifications on <code>/api/ws</code>.
`;

export function getApiConfig() {
  return new DocumentBuilder()
    .setTitle('FireFly Tokens - ERC20')
    .setDescription(API_DESCRIPTION)
    .setVersion(API_VERSION)
    .build();
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, getNestOptions());

  app.setGlobalPrefix('api/v1');
  app.useWebSocketAdapter(new WsAdapter(app));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.enableShutdownHooks([ShutdownSignal.SIGTERM, ShutdownSignal.SIGQUIT, ShutdownSignal.SIGINT]);
  app.useGlobalInterceptors(new RequestLoggingInterceptor());
  app.use(requestIDMiddleware);

  const apiConfig = getApiConfig();
  const api = SwaggerModule.createDocument(app, apiConfig, {
    extraModels: [
      EventStreamReply,
      TokenPoolEvent,
      TokenTransferEvent,
      TokenMintEvent,
      TokenBurnEvent,
      TokenApprovalEvent,
    ],
  });
  const config = app.get(ConfigService);

  SwaggerModule.setup('api', app, api);

  const ethConnectUrl = config.get<string>('ETHCONNECT_URL', '');
  const fftmUrl = config.get<string>('FFTM_URL', ''); // Optional. Currently used only for SendTransaction API calls when set
  const topic = config.get<string>('ETHCONNECT_TOPIC', 'tokenERC20ERC721');
  const username = config.get<string>('ETHCONNECT_USERNAME', '');
  const password = config.get<string>('ETHCONNECT_PASSWORD', '');
  const factoryAddress = config.get<string>('FACTORY_CONTRACT_ADDRESS', '');
  const passthroughHeaderString = config.get<string>('PASSTHROUGH_HEADERS', '');
  const legacyERC20 = config.get<string>('USE_LEGACY_ERC20_SAMPLE', '').toLowerCase() === 'true';
  const legacyERC721 = config.get<string>('USE_LEGACY_ERC721_SAMPLE', '').toLowerCase() === 'true';

  // Configuration for blockchain call retries
  const blockchainRetryCfg: RetryConfiguration = {
    retryBackOffFactor: config.get<number>('RETRY_BACKOFF_FACTOR', 2),
    retryBackOffLimit: config.get<number>('RETRY_BACKOFF_LIMIT_MS', 10000),
    retryBackOffInitial: config.get<number>('RETRY_BACKOFF_INITIAL_MS', 100),
    retryCondition: config.get<string>('RETRY_CONDITION', '.*ECONN.*'),
    retriesMax: config.get<number>('RETRY_MAX_ATTEMPTS', 15),
  };

  const passthroughHeaders: string[] = [];
  for (const h of passthroughHeaderString.split(',')) {
    passthroughHeaders.push(h.toLowerCase());
  }

  app.get(EventStreamService).configure(ethConnectUrl, username, password, passthroughHeaders);
  app.get(TokensService).configure(ethConnectUrl, topic, factoryAddress);
  app
    .get(BlockchainConnectorService)
    .configure(ethConnectUrl, fftmUrl, username, password, passthroughHeaders, blockchainRetryCfg);
  app.get(AbiMapperService).configure(legacyERC20, legacyERC721);

  const port = config.get<number>('PORT', 3000);
  console.log(`Listening on port ${port}`);
  await app.listen(port);
}

bootstrap().catch(err => {
  console.error(`Fatal error: ${err}`);
});
