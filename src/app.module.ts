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

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { TokensModule } from './tokens/tokens.module';
import { EventStreamModule } from './event-stream/event-stream.module';
import { EventStreamProxyModule } from './eventstream-proxy/eventstream-proxy.module';
import { HealthModule } from './health/health.module';
import { HealthController } from './health/health.controller';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { LoggingAndMetricsInterceptor, MetricProviders } from './logging-and-metrics.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot(),
    TokensModule,
    EventStreamModule,
    EventStreamProxyModule,
    TerminusModule,
    HealthModule,
    PrometheusModule.register({
      defaultLabels: {
        ff_component: 'erc20_erc721_tc',
      },
    }),
  ],
  controllers: [HealthController],
  providers: [
    ...MetricProviders,
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingAndMetricsInterceptor,
    },
  ],
})
export class AppModule {}
