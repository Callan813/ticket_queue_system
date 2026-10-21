import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { loggerOptions } from './lib/logger';
import { registerErrorHandler } from './plugins/errorHandler';
import { registerSwagger } from './plugins/swagger';
import { authRoutes } from './modules/auth/auth.routes';
import { eventsRoutes } from './modules/events/events.routes';
import { holdsRoutes } from './modules/holds/holds.routes';
import { bookingsRoutes } from './modules/bookings/bookings.routes';
import { ticketsRoutes } from './modules/tickets/tickets.routes';
import { paymentsRoutes } from './modules/payments/payments.routes';
import { attachSocketServer } from './realtime/socket';

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

  // Static demo page (seat map). Read once at startup; it's a single self-contained file.
  const demoHtml = readFileSync(path.join(process.cwd(), 'public', 'demo.html'), 'utf8');
  app.get('/demo', { schema: { hide: true } }, (_request, reply) => reply.type('text/html').send(demoHtml));
  app.get('/', { schema: { hide: true } }, (_request, reply) => reply.redirect('/demo'));

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(eventsRoutes);
      await api.register(holdsRoutes);
      await api.register(bookingsRoutes);
      await api.register(ticketsRoutes);
      await api.register(paymentsRoutes);
    },
    { prefix: '/api/v1' },
  );

  await attachSocketServer(app);

  return app;
}
