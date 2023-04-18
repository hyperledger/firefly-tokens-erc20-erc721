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

import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  Module,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { FFRequestIDHeader } from './request-context/constants';
import { Counter, Histogram, Gauge } from 'prom-client';
import {
  InjectMetric,
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';

const METRICS_ROUTE = '/metrics';

export const MetricProviders = [
  makeCounterProvider({
    name: 'ff_apiserver_rest_requests_total',
    help: 'Total REST API requests handled by the service',
    labelNames: ['method', 'route', 'code'],
  }),
  makeHistogramProvider({
    name: 'ff_apiserver_rest_request_size_bytes',
    help: 'Size of REST API requests in bytes',
    labelNames: ['method', 'route', 'code'],
  }),
  makeHistogramProvider({
    name: 'ff_apiserver_rest_request_duration_seconds',
    help: 'Duration of REST API requests',
    labelNames: ['method', 'route', 'code'],
  }),
  makeGaugeProvider({
    name: 'ff_event_batch_size',
    help: 'Size of event batches delivered from blockchain connector',
  }),
  makeHistogramProvider({
    name: 'ff_event_batch_interval_ms',
    help: 'Interval between the arrival of batches of events, in milliseconds',
    buckets: [250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2500],
  }),
  makeCounterProvider({
    name: 'ff_blockchain_calls_total',
    help: 'Total calls to the blockchain connector',
    labelNames: ['type'],
  }),
];

@Module({})
@Injectable()
export class LoggingAndMetricsInterceptor implements NestInterceptor {
  private readonly logger = new Logger('RequestLogging');

  constructor(
    @InjectMetric('ff_apiserver_rest_requests_total')
    private totalRequests: Counter<string>,
    @InjectMetric('ff_apiserver_rest_request_size_bytes')
    private requestSize: Histogram<string>,
    @InjectMetric('ff_apiserver_rest_request_duration_seconds')
    private requestTime: Histogram<string>,
    @InjectMetric('ff_event_batch_size')
    private eventBatchSize: Gauge<string>,
    @InjectMetric('ff_event_batch_interval_ms')
    private eventBatchInterval: Histogram<string>,
    @InjectMetric('ff_blockchain_calls_total')
    private blockchainRequests: Counter<string>,
  ) {}

  private batchSizeGaugeReset: NodeJS.Timeout;

  private isMetricsEnabledPath(path: string) {
    if (path === METRICS_ROUTE) {
      return false;
    }
    return true;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request: Request = context.switchToHttp().getRequest();
    this.logRequest(request);
    let timerCB: any;

    if (this.isMetricsEnabledPath(request.path)) {
      // Start the metrics timer for this REST call
      timerCB = this.requestTime.startTimer();
    }

    return next.handle().pipe(
      tap(() => {
        const response: Response = context.switchToHttp().getResponse();

        if (this.isMetricsEnabledPath(request.path)) {
          // End the metrics timer for this REST call
          timerCB({
            method: request.method,
            route: request.route.path,
            code: `${response.statusCode}`,
          });
        }
        this.logResponse(request, response.statusCode, response.statusMessage);
      }),
      catchError(error => {
        if ('getStatus' in error) {
          const httpError: HttpException = error;
          const response: Response = context.switchToHttp().getResponse();
          const statusCode = httpError.getStatus() ?? response.statusCode;
          const statusMessage = httpError.message;

          if (this.isMetricsEnabledPath(request.path)) {
            // End the metrics timer for this REST call
            timerCB({
              method: request.method,
              route: request.route.path,
              code: `${statusCode}`,
            });
          }
          this.logResponse(request, statusCode, statusMessage);
        }
        return throwError(() => error);
      }),
    );
  }

  private logRequest(request: Request) {
    // Log REST requests unless it's the metrics route which could be polled very frequently
    if (request.path !== METRICS_ROUTE) {
      this.logger.log(
        `${request.method} ${request.originalUrl} ${request.headers[FFRequestIDHeader]}`,
      );
    }
  }

  private logResponse(request: Request, statusCode: number, statusMessage: string) {
    if (this.isMetricsEnabledPath(request.path)) {
      this.updateMetrics(request, statusCode);
    }
    if (statusCode >= 400) {
      this.logger.warn(`${request.method} ${request.originalUrl} - ${statusCode} ${statusMessage}`);
    }
  }

  private updateMetrics(request: Request, statusCode: number) {
    this.totalRequests.labels(request.method, request.route.path, `${statusCode}`).inc();
    this.requestSize
      .labels(request.method, request.route.path, `${statusCode}`)
      .observe(request.header['content-length'] ? parseInt(request.header['content-length']) : 0);
  }

  observeBatchInterval(observedValue: number) {
    this.eventBatchInterval.observe(observedValue);
  }

  setEventBatchSize(value: number) {
    // Gauge metrics need resetting if nothing else updates them, so we use a timer to reset
    // if no new batches arrive in a given time. If we previously set a reset-timer, cancel that now...
    if (this.batchSizeGaugeReset) {
      clearTimeout(this.batchSizeGaugeReset);
    }
    // ...and set a new reset timer to reset the gauge to zero if we're not called again for a minute
    this.batchSizeGaugeReset = setTimeout(() => {
      this.eventBatchSize.set(0);
    }, 60000);
    this.eventBatchSize.set(value);
  }

  incBlockchainCalls(type: string) {
    this.blockchainRequests.labels(type).inc();
  }
}
