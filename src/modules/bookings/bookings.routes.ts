import type { FastifyInstance } from 'fastify';
import { requireRole } from '../../plugins/auth';
import { bookingRateLimit } from '../../plugins/limits';
import { toOpenApi, uuidParam } from '../../lib/validation';
import { createBookingBody, idempotencyHeaders } from './bookings.schemas';
import { bookingsController } from './bookings.controller';

const tags = ['Bookings'];
const security = [{ bearerAuth: [] }];

export async function bookingsRoutes(app: FastifyInstance) {
  app.post(
    '/bookings',
    {
      schema: {
        tags,
        summary: 'Turn a hold into a PENDING booking (idempotent via the Idempotency-Key header)',
        security,
        headers: toOpenApi(idempotencyHeaders),
        body: toOpenApi(createBookingBody),
      },
      preHandler: [requireRole('ATTENDEE'), bookingRateLimit],
    },
    bookingsController.create,
  );

  app.get(
    '/bookings/me',
    { schema: { tags, summary: 'My bookings, newest first', security }, preHandler: requireRole('ATTENDEE') },
    bookingsController.listMine,
  );

  app.post(
    '/bookings/:id/cancel',
    {
      schema: { tags, summary: 'Cancel a booking and free its seats', security, params: toOpenApi(uuidParam) },
      preHandler: requireRole('ATTENDEE'),
    },
    bookingsController.cancel,
  );
}
