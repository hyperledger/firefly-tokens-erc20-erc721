import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { IncomingHttpHeaders } from 'http';
import { FFRequestIDHeader } from '../constants';
import { newReqId } from '../request-id.middleware';

export interface Context {
  requestId: string;
  headers: IncomingHttpHeaders;
}

export const newContext = (): Context => {
  return {
    requestId: newReqId(),
    headers: {},
  };
};

export const RequestContext = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): Context => {
    const req = ctx.switchToHttp().getRequest();
    return {
      requestId: req.headers[FFRequestIDHeader],
      headers: req.headers,
    };
  },
);
