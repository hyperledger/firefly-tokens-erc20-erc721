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
import { Event, EventStreamReply } from '../event-stream/event-stream.interfaces';
import { EventStreamService, EventStreamSocket } from '../event-stream/event-stream.service';
import {
  WebSocketEventsBase,
  WebSocketEx,
  WebSocketMessage,
} from '../websocket-events/websocket-events.base';
import {
  AckMessageData,
  ConnectionListener,
  EventListener,
  WebSocketMessageBatchData,
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

  private connectListeners: ConnectionListener[] = [];
  private eventListeners: EventListener[] = [];
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
      Promise.all(this.connectListeners.map(l => l.onConnect()))
        .then(() => {
          this.setCurrentClient(client);
          this.startListening();
        })
        .catch(err => {
          this.logger.error(`Error initializing event stream proxy: ${err}`);
        });
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
        this.queueTask(() => this.processEvents(events));
      },
      receipt => {
        this.broadcast('receipt', <EventStreamReply>receipt);
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

  addConnectionListener(listener: ConnectionListener) {
    this.connectListeners.push(listener);
  }

  addEventListener(listener: EventListener) {
    this.eventListeners.push(listener);
  }

  private async processEvents(events: Event[]) {
    const messages: WebSocketMessage[] = [];
    for (const event of events) {
      this.logger.log(`Proxying event: ${JSON.stringify(event)}`);
      const subName = await this.getSubscriptionName(event.subId);
      if (subName === undefined) {
        this.logger.error(`Unknown subscription ID: ${event.subId}`);
        return;
      }

      for (const listener of this.eventListeners) {
        try {
          await listener.onEvent(subName, event, (msg: WebSocketMessage | undefined) => {
            if (msg !== undefined) {
              messages.push(msg);
            }
          });
        } catch (err) {
          this.logger.error(`Error processing event: ${err}`);
        }
      }
    }
    const message: WebSocketMessageWithId = {
      id: uuidv4(),
      event: 'batch',
      data: <WebSocketMessageBatchData>{
        events: messages,
      },
    };
    this.awaitingAck.push(message);
    this.currentClient?.send(JSON.stringify(message));
  }

  private async getSubscriptionName(subId: string) {
    const subName = this.subscriptionNames.get(subId);
    if (subName !== undefined) {
      return subName;
    }

    try {
      const sub = await this.eventstream.getSubscription(subId);
      if (sub !== undefined) {
        this.subscriptionNames.set(subId, sub.name);
        return sub.name;
      }
    } catch (err) {
      this.logger.error(`Error looking up subscription: ${err}`);
    }
    return undefined;
  }

  private setCurrentClient(client: WebSocketEx) {
    this.currentClient = client;
    for (const message of this.awaitingAck) {
      this.currentClient.send(JSON.stringify(message));
    }
  }

  @SubscribeMessage('ack')
  handleAck(@MessageBody() data: AckMessageData) {
    if (data.id === undefined) {
      this.logger.error('Received malformed ack');
      return;
    }

    this.logger.log(`Received ack ${data.id}`);
    if (this.socket !== undefined && this.awaitingAck.find(msg => msg.id === data.id)) {
      this.awaitingAck = this.awaitingAck.filter(msg => msg.id !== data.id);
      this.socket.ack();
    }
  }
}
