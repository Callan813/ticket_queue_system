import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

/** OpenAPI spec at /docs/json, interactive UI at /docs. Schemas come from the Zod schemas on each route. */
export async function registerSwagger(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Event Ticket Booking API',
        description:
          'Seat holds in Redis, race-free bookings in Postgres, live seat maps over WebSockets. ' +
          'All errors use the shape `{ error: { code, message, details } }`.',
        version: '1.0.0',
      },
      components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
}
