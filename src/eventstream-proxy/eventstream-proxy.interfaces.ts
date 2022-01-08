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

import { ApiProperty } from '@nestjs/swagger';
import { WebSocketMessage } from '../websocket-events/websocket-events.base';
import { Event } from '../event-stream/event-stream.interfaces';

export interface EventProcessor {
  (msg: WebSocketMessage | undefined): void;
}

export interface EventListener {
  onEvent: (subName: string, event: Event, process: EventProcessor) => void | Promise<void>;
}

export class ReceiptEvent {
  @ApiProperty()
  id: string;

  @ApiProperty()
  success: boolean;

  @ApiProperty()
  message?: string;
}

export interface WebSocketMessageWithId extends WebSocketMessage {
  id: string;
}

export interface AckMessageData {
  id?: string;
}
