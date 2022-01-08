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

import { Logger } from '@nestjs/common';
import { MessageBody, SubscribeMessage } from '@nestjs/websockets';
import { v4 as uuidv4 } from 'uuid';
import { Event } from '../event-stream/event-stream.interfaces';
import { EventStreamService, EventStreamSocket } from '../event-stream/event-stream.service';
import {
  WebSocketEventsBase,
  WebSocketEx,
  WebSocketMessage,
} from '../websocket-events/websocket-events.base';
import {
  AckMessageData,
  EventListener,
  ReceiptEvent,
  WebSocketMessageWithId,
} from './eventstream-proxy.interfaces';

/**
 * Base class for a websocket gateway that listens for and proxies event stream messages.
 *
 * To create the actual gateway, subclass and decorate your child, e.g.:
 * @WebSocketGateway({ path: '/api/stream' })
 */
export abstract class EventStreamProxyBase extends WebSocketEventsBase {
  socket?: EventStreamSocket;
  url?: string;
  topic?: string;

  private listeners: EventListener[] = [];
  private awaitingAck: WebSocketMessageWithId[] = [];
  private currentClient: WebSocketEx | undefined;
  private subscriptionNames = new Map<string, string>();
  private queue = Promise.resolve();

  constructor(
    protected readonly logger: Logger,
    protected eventstream: EventStreamService,
    requireAuth = false,
  ) {
    super(logger, requireAuth);
  }

  configure(url?: string, topic?: string) {
    this.url = url;
    this.topic = topic;
  }

  handleConnection(client: WebSocketEx) {
    super.handleConnection(client);
    if (this.server.clients.size === 1) {
      this.logger.log(`Initializing event stream proxy`);
      this.setCurrentClient(client);
      this.startListening();
    }
  }

  private queueTask(task: () => void) {
    this.queue = this.queue.finally(task);
  }

  private startListening() {
    if (this.url === undefined || this.topic === undefined) {
      return;
    }
    this.socket = this.eventstream.connect(
      this.url,
      this.topic,
      events => {
        for (const event of events) {
          this.queueTask(() => this.processEvent(event));
        }
        this.queueTask(() => this.checkBatchComplete());
      },
      receipt => {
        this.broadcast('receipt', <ReceiptEvent>{
          id: receipt.headers.requestId,
          success: receipt.headers.type === 'TransactionSuccess',
          message: receipt.errorMessage,
        });
      },
    );
  }

  handleDisconnect(client: WebSocketEx) {
    super.handleDisconnect(client);
    if (this.server.clients.size === 0) {
      this.stopListening();
    } else if (client.id === this.currentClient?.id) {
      for (const newClient of this.server.clients) {
        this.setCurrentClient(newClient as WebSocketEx);
        break;
      }
    }
  }

  private stopListening() {
    this.socket?.close();
    this.socket = undefined;
    this.currentClient = undefined;
  }

  addListener(listener: EventListener) {
    this.listeners.push(listener);
  }

  private async processEvent(event: Event) {
    this.logger.log(`Proxying event: ${JSON.stringify(event)}`);
    const subName = await this.getSubscriptionName(event.subId);
    if (subName === undefined) {
      this.logger.error(`Unknown subscription ID: ${event.subId}`);
      return;
    }

    for (const listener of this.listeners) {
      try {
        await listener.onEvent(subName, event, (newEvent: WebSocketMessage | undefined) => {
          if (newEvent !== undefined) {
            const message: WebSocketMessageWithId = { ...newEvent, id: uuidv4() };
            this.awaitingAck.push(message);
            this.currentClient?.send(JSON.stringify(message));
          }
        });
      } catch (err) {
        this.logger.error(`Error processing event: ${err}`);
      }
    }
  }

  private async getSubscriptionName(subId: string) {
    const subName = this.subscriptionNames.get(subId);
    if (subName !== undefined) {
      return subName;
    }
    const sub = await this.eventstream.getSubscription(subId);
    if (sub === undefined) {
      return undefined;
    }
    this.subscriptionNames.set(subId, sub.name);
    return sub.name;
  }

  private setCurrentClient(client: WebSocketEx) {
    this.currentClient = client;
    for (const message of this.awaitingAck) {
      this.currentClient.send(JSON.stringify(message));
    }
  }

  private checkBatchComplete() {
    if (this.awaitingAck.length === 0) {
      this.logger.log('Sending ack for batch');
      this.socket?.ack();
    }
  }

  @SubscribeMessage('ack')
  handleAck(@MessageBody() data: AckMessageData) {
    if (data.id === undefined) {
      this.logger.error('Received malformed ack');
      return;
    }

    this.logger.log(`Received ack ${data.id}`);
    this.awaitingAck = this.awaitingAck.filter(msg => msg.id !== data.id);
    this.checkBatchComplete();
  }
}
