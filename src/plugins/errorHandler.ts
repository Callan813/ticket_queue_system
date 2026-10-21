import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';

/** Maps every thrown error to the API's single error shape: { error: { code, message, details } }. */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | AppError | ZodError, request, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details ?? null },
      });
    }

    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }

    // Errors raised by Fastify itself (malformed JSON, body too large, ...).
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({
        error: { code: err.code ?? 'BAD_REQUEST', message: err.message, details: null },
      });
    }

    request.log.error({ err }, 'Unhandled error');
    return reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', details: null },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found`, details: null },
    });
  });
}
