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

import { ClientRequest } from 'http';
import { HttpService } from '@nestjs/axios';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { Observable, lastValueFrom } from 'rxjs';
import { EventStreamReply } from '../event-stream/event-stream.interfaces';
import { basicAuth } from '../utils';
import { Context } from '../request-context/request-context.decorator';
import { FFRequestIDHeader } from '../request-context/constants';
import { EthConnectAsyncResponse, EthConnectReturn, IAbiMethod } from './tokens.interfaces';

const sendTransactionHeader = 'SendTransaction';
const queryHeader = 'Query';

@Injectable()
export class BlockchainConnectorService {
  private readonly logger = new Logger(BlockchainConnectorService.name);

  baseUrl: string;
  fftmUrl: string;
  username: string;
  password: string;
  passthroughHeaders: string[];

  retryBackOffFactor: number;
  retryBackOffLimit: number;
  retryBackOffInitial: number;
  retryCondition: string;
  retriesMax: number;

  constructor(public http: HttpService) {}

  configure(
    baseUrl: string,
    fftmUrl: string,
    username: string,
    password: string,
    passthroughHeaders: string[],
    retryBackOffFactor: number,
    retryBackOffLimit: number,
    retryBackOffInitial: number,
    retryCondition: string,
    retriesMax: number,
  ) {
    this.baseUrl = baseUrl;
    this.fftmUrl = fftmUrl;
    this.username = username;
    this.password = password;
    this.passthroughHeaders = passthroughHeaders;
    this.retryBackOffFactor = retryBackOffFactor;
    this.retryBackOffLimit = retryBackOffLimit;
    this.retryBackOffInitial = retryBackOffInitial;
    this.retryCondition = retryCondition;
    this.retriesMax = retriesMax;
  }

  private requestOptions(ctx: Context): AxiosRequestConfig {
    const headers = {};
    for (const key of this.passthroughHeaders) {
      const value = ctx.headers[key];
      if (value !== undefined) {
        headers[key] = value;
      }
    }
    headers[FFRequestIDHeader] = ctx.requestId;
    const config = basicAuth(this.username, this.password);
    config.headers = headers;
    return config;
  }

  private async wrapError<T>(response: Promise<AxiosResponse<T>>) {
    return response.catch(err => {
      if (axios.isAxiosError(err)) {
        const request: ClientRequest | undefined = err.request;
        const response: AxiosResponse | undefined = err.response;
        const errorMessage = response?.data?.error ?? err.message;
        this.logger.warn(
          `${request?.path} <-- HTTP ${response?.status} ${response?.statusText}: ${errorMessage}`,
        );
        throw new InternalServerErrorException(errorMessage);
      }
      throw err;
    });
  }

  // Check if retry condition matches the err that's been hit
  private matchesRetryCondition(err: any): boolean {
    return this.retryCondition != '' && err?.toString().match(this.retryCondition) !== null;
  }

  // Delay by the appropriate amount of time given the iteration the caller is in
  private async backoffDelay(iteration: number) {
    const delay = Math.min(
      this.retryBackOffInitial * Math.pow(this.retryBackOffFactor, iteration),
      this.retryBackOffLimit,
    );
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  // Generic helper function that makes an given blockchain function retryable
  // by using synchronous, back-off delays for cases where the function returns
  // an error which matches the configured retry condition
  private async retryableCall<T = any>(
    blockchainFunction: () => Promise<AxiosResponse<T>>,
  ): Promise<AxiosResponse<T>> {
    let response: any;
    for (let retries = 0; retries < this.retriesMax; retries++) {
      try {
        response = await blockchainFunction();
      } catch (e) {
        console.log('Caught exception e trying to call a blockchain function: ' + e.toString());

        if (this.matchesRetryCondition(e)) {
          // Wait for a backed-off delay before trying again
          await this.backoffDelay(retries);
        } else {
          // Whatever the error was it's not one we will retry for
          break;
        }
      }
    }

    return response;
  }

  async query(ctx: Context, to: string, method?: IAbiMethod, params?: any[]) {
    const url = this.baseUrl;
    const response = await this.retryableCall<EthConnectReturn>(
      async (): Promise<AxiosResponse<EthConnectReturn>> => {
        return await this.wrapError(
          lastValueFrom(
            this.http.post(
              url,
              { headers: { type: queryHeader }, to, method, params },
              this.requestOptions(ctx),
            ),
          ),
        );
      },
    );
    return response.data;
  }

  async sendTransaction(
    ctx: Context,
    from: string,
    to: string,
    id?: string,
    method?: IAbiMethod,
    params?: any[],
  ) {
    const url = this.fftmUrl !== undefined && this.fftmUrl !== '' ? this.fftmUrl : this.baseUrl;

    const response = await this.retryableCall<EthConnectAsyncResponse>(
      async (): Promise<AxiosResponse<EthConnectAsyncResponse>> => {
        return await this.wrapError(
          lastValueFrom(
            this.http.post(
              url,
              { headers: { id, type: sendTransactionHeader }, from, to, method, params },
              this.requestOptions(ctx),
            ),
          ),
        );
      },
    );
    return response.data;
  }

  async getReceipt(ctx: Context, id: string): Promise<EventStreamReply> {
    const url = this.baseUrl;
    const response = await this.retryableCall<EventStreamReply>(
      async (): Promise<AxiosResponse<EventStreamReply>> => {
        return await this.wrapError(
          lastValueFrom(
            this.http.get(new URL(`/reply/${id}`, url).href, {
              validateStatus: status => status < 300 || status === 404,
              ...this.requestOptions(ctx),
            }),
          ),
        );
      },
    );
    if (response.status === 404) {
      throw new NotFoundException();
    }
    return response.data;
  }
}
