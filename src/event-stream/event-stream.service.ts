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

import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { lastValueFrom } from 'rxjs';
import * as WebSocket from 'ws';
import { basicAuth } from '../utils';
import {
  Event,
  EventStream,
  EventStreamReply,
  EventStreamSubscription,
} from './event-stream.interfaces';

const RECONNECT_TIME = 5000;
const PING_INTERVAL = 10000;
const PING_TIMEOUT = 60000;

export class EventStreamSocket {
  private readonly logger = new Logger(EventStreamSocket.name);

  private ws: WebSocket;
  private pingTimeout: NodeJS.Timeout;
  private disconnectDetected = false;
  private closeRequested = false;

  constructor(
    private url: string,
    private topic: string,
    private username: string,
    private password: string,
    private handleEvents: (events: Event[]) => void,
    private handleReceipt: (receipt: EventStreamReply) => void,
  ) {
    this.init();
  }

  private init() {
    this.disconnectDetected = false;
    this.closeRequested = false;

    const auth =
      this.username && this.password ? { auth: `${this.username}:${this.password}` } : undefined;
    this.ws = new WebSocket(this.url, auth);
    this.ws
      .on('open', () => {
        if (this.disconnectDetected) {
          this.disconnectDetected = false;
          this.logger.log('Event stream websocket restored');
        } else {
          this.logger.log('Event stream websocket connected');
        }
        this.produce({ type: 'listen', topic: this.topic });
        this.produce({ type: 'listenreplies' });
        this.ping();
      })
      .on('close', () => {
        if (this.closeRequested) {
          this.logger.log('Event stream websocket closed');
        } else {
          this.disconnectDetected = true;
          this.logger.error(
            `Event stream websocket disconnected, attempting to reconnect in ${RECONNECT_TIME}ms`,
          );
          setTimeout(() => this.init(), RECONNECT_TIME);
        }
      })
      .on('message', (message: string) => {
        this.handleMessage(JSON.parse(message));
      })
      .on('pong', () => {
        clearTimeout(this.pingTimeout);
        setTimeout(() => this.ping(), PING_INTERVAL);
      })
      .on('error', err => {
        this.logger.error(`Event stream websocket error: ${err}`);
      });
  }

  private ping() {
    if (this.ws !== undefined && this.ws.readyState === WebSocket.OPEN) {
      this.ws.ping();
      this.pingTimeout = setTimeout(() => {
        this.logger.error('Event stream ping timeout');
        this.ws.terminate();
      }, PING_TIMEOUT);
    }
  }

  private produce(message: any) {
    this.ws.send(JSON.stringify(message));
  }

  ack() {
    this.produce({ type: 'ack', topic: this.topic });
  }

  close() {
    this.closeRequested = true;
    this.ws.terminate();
  }

  private handleMessage(message: EventStreamReply | Event[]) {
    if (Array.isArray(message)) {
      for (const event of message) {
        this.logger.log(`Ethconnect '${event.signature}' message: ${JSON.stringify(event.data)}`);
      }
      this.handleEvents(message);
    } else {
      const replyType = message.headers.type;
      const errorMessage = message.errorMessage ?? '';
      this.logger.log(
        `Ethconnect '${replyType}' reply request=${message.headers.requestId} tx=${message.transactionHash} ${errorMessage}`,
      );
      this.handleReceipt(message);
    }
  }
}

@Injectable()
export class EventStreamService {
  private readonly logger = new Logger(EventStreamService.name);

  private baseUrl: string;
  private username: string;
  private password: string;

  constructor(private http: HttpService) {}

  configure(baseUrl: string, username: string, password: string) {
    this.baseUrl = baseUrl;
    this.username = username;
    this.password = password;
  }

  async getStreams(): Promise<EventStream[]> {
    const response = await lastValueFrom(
      this.http.get<EventStream[]>(`${this.baseUrl}/eventstreams`, {
        ...basicAuth(this.username, this.password),
      }),
    );
    return response.data;
  }

  async createOrUpdateStream(topic: string): Promise<EventStream> {
    const streamDetails = {
      name: topic,
      errorHandling: 'block',
      batchSize: 50,
      batchTimeoutMS: 500,
      type: 'websocket',
      websocket: { topic },
      blockedReryDelaySec: 30, // intentional due to spelling error in ethconnect
      inputs: true,
      timestamps: true,
    };

    const existingStreams = await this.getStreams();
    const stream = existingStreams.find(s => s.name === streamDetails.name);
    if (stream) {
      const patchedStreamRes = await lastValueFrom(
        this.http.patch<EventStream>(
          `${this.baseUrl}/eventstreams/${stream.id}`,
          {
            ...streamDetails,
          },
          {
            ...basicAuth(this.username, this.password),
          },
        ),
      );
      this.logger.log(`Event stream for ${topic}: ${stream.id}`);
      return patchedStreamRes.data;
    }
    const newStreamRes = await lastValueFrom(
      this.http.post<EventStream>(
        `${this.baseUrl}/eventstreams`,
        {
          ...streamDetails,
        },
        {
          ...basicAuth(this.username, this.password),
        },
      ),
    );
    this.logger.log(`Event stream for ${topic}: ${newStreamRes.data.id}`);
    return newStreamRes.data;
  }

  async deleteStream(id: string) {
    await lastValueFrom(
      this.http.delete(`${this.baseUrl}/eventstreams/${id}`, {
        ...basicAuth(this.username, this.password),
      }),
    );
  }

  async getSubscriptions(): Promise<EventStreamSubscription[]> {
    const response = await lastValueFrom(
      this.http.get<EventStreamSubscription[]>(`${this.baseUrl}/subscriptions`, {
        ...basicAuth(this.username, this.password),
      }),
    );
    return response.data;
  }

  async getSubscription(subId: string): Promise<EventStreamSubscription | undefined> {
    const response = await lastValueFrom(
      this.http.get<EventStreamSubscription>(`${this.baseUrl}/subscriptions/${subId}`, {
        validateStatus: status => status < 300 || status === 404,
        ...basicAuth(this.username, this.password),
      }),
    );
    if (response.status === 404) {
      return undefined;
    }
    return response.data;
  }

  async createSubscription(
    instancePath: string,
    streamId: string,
    event: string,
    name: string,
    fromBlock = '0', // subscribe from the start of the chain by default
  ): Promise<EventStreamSubscription> {
    const response = await lastValueFrom(
      this.http.post<EventStreamSubscription>(
        `${instancePath}/${event}`,
        {
          name,
          stream: streamId,
          fromBlock,
        },
        {
          ...basicAuth(this.username, this.password),
        },
      ),
    );
    this.logger.log(`Created subscription ${event}: ${response.data.id}`);
    return response.data;
  }

  async getOrCreateSubscription(
    instancePath: string,
    streamId: string,
    event: string,
    name: string,
    fromBlock = '0', // subscribe from the start of the chain by default
  ): Promise<EventStreamSubscription> {
    const existingSubscriptions = await this.getSubscriptions();
    const sub = existingSubscriptions.find(s => s.name === name && s.stream === streamId);
    if (sub) {
      this.logger.log(`Existing subscription for ${event}: ${sub.id}`);
      return sub;
    }
    return this.createSubscription(instancePath, streamId, event, name, fromBlock);
  }

  connect(
    url: string,
    topic: string,
    handleEvents: (events: Event[]) => void,
    handleReceipt: (receipt: EventStreamReply) => void,
  ) {
    return new EventStreamSocket(
      url,
      topic,
      this.username,
      this.password,
      handleEvents,
      handleReceipt,
    );
  }
}
