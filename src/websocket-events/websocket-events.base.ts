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

import * as http from 'http';
import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketServer,
} from '@nestjs/websockets';
import { nanoid } from 'nanoid';
import WebSocket, { Server } from 'ws';

const PING_INTERVAL = 5000;

function checkApiKey(_request: http.IncomingMessage) {
  // TODO: implement
  return false;
}

export interface WebSocketEx extends WebSocket {
  isAlive: boolean;
  id: string;
  request?: http.IncomingMessage;
}

/**
 * Message format expected by @SubscribeMessage()
 *
 * While technically the websocket messages (in both directions) could
 * use any arbitrary format, this format is simple and has the advantage
 * of playing nice with NestJS decorators for incoming events.
 */
export interface WebSocketMessage {
  event: string;
  data: any;
}

/**
 * Base class for websocket gateways.
 *
 * To create a new gateway, subclass and decorate your child, e.g.:
 * @WebSocketGateway({ path: '/api/ws' })
 */
export abstract class WebSocketEventsBase
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;

  constructor(protected readonly logger: Logger, private requireAuth = false) {}

  afterInit(server: Server) {
    const interval = setInterval(() => this.ping(), PING_INTERVAL);
    server.on('connection', (client: WebSocketEx, req) => {
      client.id = nanoid();
      client.isAlive = true;
      client.request = req;
      if (this.requireAuth && !checkApiKey(req)) {
        this.logger.log(`WebSocket ${client.id}: unauthorized`);
        client.close(1008, 'Unauthorized');
      }
    });
    server.on('close', () => clearInterval(interval));
  }

  handleConnection(client: WebSocketEx) {
    this.logger.log(`WebSocket ${client.id}: connected`);

    client.on('pong', () => {
      client.isAlive = true;
    });
    client.on('error', err => {
      this.logger.log(`WebSocket ${client.id}: error: ${err}`);
    });
  }

  handleDisconnect(client: WebSocketEx) {
    this.logger.log(`WebSocket ${client.id}: disconnected`);
  }

  ping() {
    this.server?.clients.forEach(ws => {
      const client = ws as WebSocketEx;
      if (client.isAlive === false) {
        this.logger.log(`WebSocket ${client.id}: connection lost`);
        return client.terminate();
      }
      client.isAlive = false;
      client.ping();
    });
  }

  broadcast(event: string, data: any = null) {
    const payload = JSON.stringify(<WebSocketMessage>{ event, data });
    const clients = this.server.clients;
    clients.forEach(client => client.send(payload));
    return clients.size;
  }
}
