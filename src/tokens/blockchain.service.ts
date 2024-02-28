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

import { ClientRequest } from 'http';
import { HttpService } from '@nestjs/axios';
import {
  ConflictException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { lastValueFrom } from 'rxjs';
import { EventStreamReply } from '../event-stream/event-stream.interfaces';
import { getHttpRequestOptions } from '../utils';
import { Context } from '../request-context/request-context.decorator';
import { FFRequestIDHeader } from '../request-context/constants';
import { EthConnectAsyncResponse, EthConnectReturn, IAbiMethod } from './tokens.interfaces';

export interface RetryConfiguration {
  retryBackOffFactor: number;
  retryBackOffLimit: number;
  retryBackOffInitial: number;
  retryCondition: string;
  retriesMax: number;
}

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

  retryConfiguration: RetryConfiguration;

  constructor(public http: HttpService) {}

  configure(
    baseUrl: string,
    fftmUrl: string,
    username: string,
    password: string,
    passthroughHeaders: string[],
    retryConfiguration: RetryConfiguration,
  ) {
    this.baseUrl = baseUrl;
    this.fftmUrl = fftmUrl;
    this.username = username;
    this.password = password;
    this.passthroughHeaders = passthroughHeaders;
    this.retryConfiguration = retryConfiguration;
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
    const config = getHttpRequestOptions(this.username, this.password);
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
        if (response?.status == HttpStatus.CONFLICT) {
          // Pass a 409 through
          throw new ConflictException(errorMessage);
        } else {
          // Otherwise always return a 500 if the blockchain connector request wasn't successful
          throw new InternalServerErrorException(errorMessage);
        }
      }
      throw err;
    });
  }

  // Check if retry condition matches the err that's been hit
  private matchesRetryCondition(err: any): boolean {
    return (
      this.retryConfiguration.retryCondition !== '' &&
      `${err}`.match(this.retryConfiguration.retryCondition) !== null
    );
  }

  // Delay by the appropriate amount of time given the iteration the caller is in
  private async backoffDelay(iteration: number) {
    const delay = Math.min(
      this.retryConfiguration.retryBackOffInitial *
        Math.pow(this.retryConfiguration.retryBackOffFactor, iteration),
      this.retryConfiguration.retryBackOffLimit,
    );
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  // Generic helper function that makes a given blockchain function retryable
  // by using synchronous back-off delays for cases where the function returns
  // an error which matches the configured retry condition
  private async retryableCall<T = any>(
    blockchainFunction: () => Promise<AxiosResponse<T>>,
  ): Promise<AxiosResponse<T>> {
    let retries = 0;
    for (
      ;
      this.retryConfiguration.retriesMax === -1 || retries <= this.retryConfiguration.retriesMax;
      this.retryConfiguration.retriesMax === -1 || retries++ // Don't inc 'retries' if 'retriesMax' if set to -1 (infinite retries)
    ) {
      try {
        return await blockchainFunction();
      } catch (e) {
        if (this.matchesRetryCondition(e)) {
          this.logger.debug(`Retry condition matched for error ${e}`);
          // Wait for a backed-off delay before trying again
          await this.backoffDelay(retries);
        } else {
          // Whatever the error was it's not one we will retry for
          throw e;
        }
      }
    }

    throw new InternalServerErrorException(
      `Call to blockchain connector failed after ${retries} attempts`,
    );
  }

  async query(ctx: Context, to: string, method?: IAbiMethod, params?: any[]) {
    const url = this.baseUrl;
    const response = await this.wrapError(
      this.retryableCall<EthConnectReturn>(async (): Promise<AxiosResponse<EthConnectReturn>> => {
        return lastValueFrom(
          this.http.post(
            url,
            { headers: { type: queryHeader }, to, method, params },
            this.requestOptions(ctx),
          ),
        );
      }),
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

    const response = await this.wrapError(
      this.retryableCall<EthConnectAsyncResponse>(
        async (): Promise<AxiosResponse<EthConnectAsyncResponse>> => {
          return lastValueFrom(
            this.http.post(
              url,
              { headers: { id, type: sendTransactionHeader }, from, to, method, params },
              this.requestOptions(ctx),
            ),
          );
        },
      ),
    );
    return response.data;
  }

  async getReceipt(ctx: Context, id: string): Promise<EventStreamReply> {
    const url = this.baseUrl;
    const response = await this.wrapError(
      this.retryableCall<EventStreamReply>(async (): Promise<AxiosResponse<EventStreamReply>> => {
        return lastValueFrom(
          this.http.get(new URL(`/reply/${id}`, url).href, {
            validateStatus: status => status < 300 || status === 404,
            ...this.requestOptions(ctx),
          }),
        );
      }),
    );
    if (response.status === 404) {
      throw new NotFoundException();
    }
    return response.data;
  }
}
