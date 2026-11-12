import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { ProblemDetails } from '@fastighetsradar/domain';

/** Typed application error rendered as RFC 9457 problem details. */
export class HttpProblem extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    public readonly detail?: string,
    public readonly type = 'about:blank',
  ) {
    super(detail ?? title);
    this.name = 'HttpProblem';
  }
}

export function registerErrorHandling(app: FastifyInstance) {
  app.setNotFoundHandler((req, reply) => {
    const body: ProblemDetails = {
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: `Route ${req.method} ${req.url.split('?')[0]} not found`,
      instance: req.url.split('?')[0],
      requestId: req.id,
    };
    reply.code(404).type('application/problem+json').send(body);
  });

  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    let body: ProblemDetails;
    if (err instanceof HttpProblem) {
      body = { type: err.type, title: err.title, status: err.status, detail: err.detail };
    } else if (err instanceof ZodError) {
      body = {
        type: 'about:blank',
        title: 'Validation failed',
        status: 400,
        errors: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    } else if ('statusCode' in err && typeof err.statusCode === 'number' && err.statusCode < 500) {
      body = { type: 'about:blank', title: err.name || 'Bad Request', status: err.statusCode, detail: err.message };
    } else {
      req.log.error({ err }, 'Unhandled error');
      // Do not leak internals for 5xx.
      body = { type: 'about:blank', title: 'Internal Server Error', status: 500 };
    }
    body.instance = req.url.split('?')[0];
    body.requestId = req.id;
    reply.code(body.status).type('application/problem+json').send(body);
  });
}
