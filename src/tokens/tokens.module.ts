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
import { HttpModule } from '@nestjs/axios';
import { EventStreamProxyModule } from '../eventstream-proxy/eventstream-proxy.module';
import { EventStreamModule } from '../event-stream/event-stream.module';
import { TokensController } from './tokens.controller';
import { TokensService } from './tokens.service';
@Module({
  imports: [
    HttpModule.register({
      timeout: 30000,
    }),
    EventStreamModule,
    EventStreamProxyModule,
  ],
  controllers: [TokensController],
  providers: [TokensService],
})
export class TokensModule {}
