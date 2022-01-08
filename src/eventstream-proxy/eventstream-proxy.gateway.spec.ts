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

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventStreamService } from '../event-stream/event-stream.service';
import { EventStreamProxyGateway } from './eventstream-proxy.gateway';

describe('EventStreamProxyGateway', () => {
  let gateway: EventStreamProxyGateway;
  const config = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventStreamProxyGateway,
        {
          provide: ConfigService,
          useValue: config,
        },
        {
          provide: EventStreamService,
          useValue: jest.fn(),
        },
      ],
    }).compile();

    gateway = module.get<EventStreamProxyGateway>(EventStreamProxyGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });
});
