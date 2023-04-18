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
import { Context, newContext } from '../request-context/request-context.decorator';
import { EventBatch, EventStreamReply } from '../event-stream/event-stream.interfaces';
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
import { LoggingAndMetricsInterceptor } from '../logging-and-metrics.interceptor';

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
  private mostRecentBatchTimestamp = new Date();

  constructor(
    protected readonly logger: Logger,
    protected eventstream: EventStreamService,
    requireAuth = false,
    protected metrics: LoggingAndMetricsInterceptor,
  ) {
    super(logger, requireAuth, metrics);
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

  private async processEvents(batch: EventBatch) {
    this.logger.log('Recording batch size metric of ' + batch.events.length);

    // Record metrics
    this.metrics.setEventBatchSize(batch.events.length);
    let timestamp = new Date();
    this.logger.log(
      'Recording batch interval of ' +
        (timestamp.getTime() - this.mostRecentBatchTimestamp.getTime()) +
        ' milliseconds',
    );
    this.metrics.observeBatchInterval(
      timestamp.getTime() - this.mostRecentBatchTimestamp.getTime(),
    );
    this.mostRecentBatchTimestamp = timestamp;

    const messages: WebSocketMessage[] = [];
    const eventHandlers: Promise<WebSocketMessage | undefined>[] = [];
    for (const event of batch.events) {
      this.logger.log(`Proxying event: ${JSON.stringify(event)}`);
      const subName = await this.getSubscriptionName(newContext(), event.subId);
      if (subName === undefined) {
        this.logger.error(`Unknown subscription ID: ${event.subId}`);
        return;
      }

      for (const listener of this.eventListeners) {
        // Some events require enrichment that could involve a call to the blockchain,
        // so we don't want to do those synchronously. Create a promise for each onEvent()
        // handler and when they're all complete we'll create the batch message
        eventHandlers.push(Promise.resolve(listener.onEvent(subName, event)));
      }
    }

    // Now we need to await the promises in order so the messages stay in order
    for (const nextProm of eventHandlers) {
      try {
        const msg = await nextProm;
        if (msg !== undefined) {
          messages.push(msg);
        }
      } catch (err) {
        this.logger.error(`Error processing event: ${err}`);
      }
    }
    const message: WebSocketMessageWithId = {
      id: uuidv4(),
      event: 'batch',
      data: <WebSocketMessageBatchData>{
        events: messages,
      },
      batchNumber: batch.batchNumber,
    };
    this.awaitingAck.push(message);
    this.currentClient?.send(JSON.stringify(message));
  }

  private async getSubscriptionName(ctx: Context, subId: string) {
    const subName = this.subscriptionNames.get(subId);
    if (subName !== undefined) {
      return subName;
    }

    try {
      const sub = await this.eventstream.getSubscription(ctx, subId);
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

    const inflight = this.awaitingAck.find(msg => msg.id === data.id);
    this.logger.log(`Received ack ${data.id} inflight=${!!inflight}`);
    if (this.socket !== undefined && inflight !== undefined) {
      this.awaitingAck = this.awaitingAck.filter(msg => msg.id !== data.id);
      if (
        // If nothing is left awaiting an ack - then we clearly need to ack
        this.awaitingAck.length === 0 ||
        // Or if we have a batch number associated with this ID, then we can only ack if there
        // are no other messages in-flight with the same batch number.
        (inflight.batchNumber !== undefined &&
          !this.awaitingAck.find(msg => msg.batchNumber === inflight.batchNumber))
      ) {
        this.logger.log(`In-flight batch complete (batchNumber=${inflight.batchNumber})`);
        this.socket.ack(inflight.batchNumber);
      }
    }
  }
}
