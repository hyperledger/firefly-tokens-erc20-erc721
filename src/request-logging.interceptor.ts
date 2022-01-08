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
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('RequestLogging');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request: Request = context.switchToHttp().getRequest();
    this.logRequest(request);
    return next.handle().pipe(
      tap(() => {
        const response: Response = context.switchToHttp().getResponse();
        this.logResponse(request, response.statusCode, response.statusMessage);
      }),
      catchError(error => {
        if ('getStatus' in error) {
          const httpError: HttpException = error;
          const response: Response = context.switchToHttp().getResponse();
          const statusCode = httpError.getStatus() ?? response.statusCode;
          const statusMessage = httpError.message;
          this.logResponse(request, statusCode, statusMessage);
        }
        return throwError(() => new Error(error));
      }),
    );
  }

  private logRequest(request: Request) {
    this.logger.log(`${request.method} ${request.originalUrl}`);
  }

  private logResponse(request: Request, statusCode: number, statusMessage: string) {
    if (statusCode >= 400) {
      this.logger.warn(`${request.method} ${request.originalUrl} - ${statusCode} ${statusMessage}`);
    }
  }
}
