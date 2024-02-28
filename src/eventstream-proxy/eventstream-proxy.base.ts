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

import { Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { Context, newContext } from '../request-context/request-context.decorator';
import { EventBatch, EventStreamReply } from '../event-stream/event-stream.interfaces';
import { EventStreamService, EventStreamSocket } from '../event-stream/event-stream.service';
import {
  WebSocketAck,
  WebSocketActionBase,
  WebSocketEventsBase,
  WebSocketEx,
  WebSocketMessage,
  WebSocketStart,
} from '../websocket-events/websocket-events.base';
import {
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
  namespaceClients: Map<string, Set<WebSocketEx>> = new Map();
  namespaceEventStreamSocket: Map<string, EventStreamSocket> = new Map();
  url?: string;
  topic?: string;

  private eventListeners: EventListener[] = [];
  // Map of client IDs to all the messages for which we are awaiting an ack
  private awaitingAck: Map<string, WebSocketMessageWithId[]> = new Map();
  private subscriptionNames = new Map<string, string>();
  private queue = Promise.resolve();

  constructor(
    protected readonly logger: Logger,
    protected eventStreamService: EventStreamService,
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

    if (!this.awaitingAck.get(client.id)) {
      this.awaitingAck.set(client.id, []);
    }

    client.on('message', async (message: string) => {
      const action = JSON.parse(message) as WebSocketActionBase;
      switch (action.type) {
        case 'start': {
          const startAction = action as WebSocketStart;
          this.startListening(client, startAction.namespace);
          break;
        }
        case 'ack': {
          const ackAction = action as WebSocketAck;
          this.handleAck(client, ackAction);
        }
      }
    });
  }

  private queueTask(task: () => void) {
    this.queue = this.queue.finally(task);
  }

  private async startListening(client: WebSocketEx, namespace: string) {
    if (this.url === undefined || this.topic === undefined) {
      return;
    }
    try {
      if (!this.namespaceEventStreamSocket.has(namespace)) {
        const eventStreamSocket = await this.eventStreamService.connect(
          this.url,
          this.topic,
          namespace,
          events => {
            this.queueTask(() => this.processEvents(events, namespace));
          },
          receipt => {
            this.broadcast('receipt', <EventStreamReply>receipt);
          },
        );
        this.namespaceEventStreamSocket.set(namespace, eventStreamSocket);
      }
      let clientSet = this.namespaceClients.get(namespace);
      if (!clientSet) {
        clientSet = new Set<WebSocketEx>();
      }
      clientSet.add(client);
      this.namespaceClients.set(namespace, clientSet);

      // ack the start command
      client.send(
        JSON.stringify({
          event: 'started',
          data: {
            namespace: namespace,
          },
        }),
      );
      this.logger.debug(`Started namespace '${namespace}'`);
    } catch (e) {
      this.logger.error(`Error connecting to event stream websocket: ${e.message}`);
    }
  }

  handleDisconnect(client: WebSocketEx) {
    super.handleDisconnect(client);

    // Iterate over all the namespaces this client was subscribed to
    this.namespaceClients.forEach((clientSet, namespace) => {
      clientSet.delete(client);

      // Nack any messages that are inflight for that namespace
      const nackedMessageIds: Set<string> = new Set();
      this.awaitingAck
        ?.get(client.id)
        ?.filter(msg => msg.namespace === namespace)
        .map(msg => {
          this.namespaceEventStreamSocket.get(namespace)?.nack(msg.batchNumber);
          nackedMessageIds.add(msg.id);
        });
      this.awaitingAck.delete(client.id);

      // If all clients for this namespace have disconnected, also close the connection to EVMConnect
      if (clientSet.size == 0) {
        this.namespaceEventStreamSocket.get(namespace)?.close();
        this.namespaceEventStreamSocket.delete(namespace);
        this.namespaceClients.delete(namespace);
      }
    });
  }

  addEventListener(listener: EventListener) {
    this.eventListeners.push(listener);
  }

  private async processEvents(batch: EventBatch, namespace: string) {
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
      namespace: namespace,
      id: uuidv4(),
      event: 'batch',
      data: <WebSocketMessageBatchData>{
        events: messages,
      },
      batchNumber: batch.batchNumber,
    };
    this.send(namespace, message);
  }

  private async getSubscriptionName(ctx: Context, subId: string) {
    const subName = this.subscriptionNames.get(subId);
    if (subName !== undefined) {
      return subName;
    }

    try {
      const sub = await this.eventStreamService.getSubscription(ctx, subId);
      if (sub !== undefined) {
        this.subscriptionNames.set(subId, sub.name);
        return sub.name;
      }
    } catch (err) {
      this.logger.error(`Error looking up subscription: ${err}`);
    }
    return undefined;
  }

  handleAck(client: WebSocketEx, data: WebSocketAck) {
    if (data.id === undefined) {
      this.logger.error('Received malformed ack');
      return;
    }

    let awaitingAck = this.awaitingAck.get(client.id);

    if (awaitingAck) {
      const inflight = awaitingAck.find(msg => msg.id === data.id);
      this.logger.log(`Received ack ${data.id} inflight=${!!inflight}`);
      if (this.namespaceEventStreamSocket !== undefined && inflight !== undefined) {
        // Remove the acked message id from the queue
        awaitingAck = awaitingAck.filter(msg => msg.id !== data.id);
        this.awaitingAck.set(client.id, awaitingAck);
        if (
          // If nothing is left awaiting an ack - then we clearly need to ack
          awaitingAck.length === 0 ||
          // Or if we have a batch number associated with this ID, then we can only ack if there
          // are no other messages in-flight with the same batch number.
          (inflight.batchNumber !== undefined &&
            !awaitingAck.filter(msg => msg.batchNumber === inflight.batchNumber))
        ) {
          this.logger.log(`In-flight batch complete (batchNumber=${inflight.batchNumber})`);
          this.namespaceEventStreamSocket.get(inflight.namespace)?.ack(inflight.batchNumber);
        }
      }
    } else {
      this.logger.warn(`Received unrecognized ack from client ${client.id} for message ${data.id}`);
    }
  }

  send(namespace, payload: WebSocketMessageWithId) {
    const clients = this.namespaceClients.get(namespace);
    if (clients) {
      // Randomly select a connected client for this namespace to distribute load
      const selected = Math.floor(Math.random() * clients.size);
      let i = 0;
      for (const client of clients.keys()) {
        if (i++ == selected) {
          this.awaitingAck.get(client.id)?.push(payload);
          this.logger.verbose(`WS <= ${payload}`);
          client.send(JSON.stringify(payload));
          return;
        }
      }
    }
  }
}
