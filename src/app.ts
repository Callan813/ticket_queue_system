import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { loggerOptions } from './lib/logger';
import { registerErrorHandler } from './plugins/errorHandler';
import { registerSwagger } from './plugins/swagger';
import { authRoutes } from './modules/auth/auth.routes';
import { eventsRoutes } from './modules/events/events.routes';
import { holdsRoutes } from './modules/holds/holds.routes';
import { bookingsRoutes } from './modules/bookings/bookings.routes';

declare module 'fastify' {
  interface FastifyRequest {
    /** The exact request body bytes, needed to verify payment webhook signatures. */
    rawBody?: string;
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions,
    // Honour an incoming X-Request-Id (e.g. from a load balancer) or make one up.
    // Fastify attaches it to every log line for this request as `reqId`.
    genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(),
    requestIdHeader: false,
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // Parse JSON ourselves so the raw string is kept alongside the parsed body.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    request.rawBody = body as string;
    if (!body) return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(Object.assign(new Error('Request body is not valid JSON'), { statusCode: 400, code: 'INVALID_JSON' }));
    }
  });

  // Zod validates every input in the controllers. Route JSON schemas exist only
  // to generate the OpenAPI docs, so turn off Fastify's built-in validation.
  app.setValidatorCompiler(() => (data) => ({ value: data }));

  registerErrorHandler(app);
  await registerSwagger(app);

  app.get('/health', { schema: { hide: true } }, async () => ({ status: 'ok' }));

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(eventsRoutes);
      await api.register(holdsRoutes);
      await api.register(bookingsRoutes);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
