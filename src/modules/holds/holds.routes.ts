import type { FastifyInstance } from 'fastify';
import { requireRole } from '../../plugins/auth';
import { bookingRateLimit } from '../../plugins/limits';
import { toOpenApi, uuidParam } from '../../lib/validation';
import { createHoldBody, holdIdParam } from './holds.schemas';
import { holdsController } from './holds.controller';

const tags = ['Holds'];
const security = [{ bearerAuth: [] }];

export async function holdsRoutes(app: FastifyInstance) {
  app.post(
    '/events/:id/holds',
    {
      schema: {
        tags,
        summary: 'Hold seats for a few minutes (all-or-nothing; 409 lists the taken seats)',
        security,
        params: toOpenApi(uuidParam),
        body: toOpenApi(createHoldBody),
      },
      preHandler: [requireRole('ATTENDEE'), bookingRateLimit],
    },
    holdsController.create,
  );

  app.delete(
    '/holds/:holdId',
    {
      schema: { tags, summary: 'Release a hold early', security, params: toOpenApi(holdIdParam) },
      preHandler: requireRole('ATTENDEE'),
    },
    holdsController.release,
  );
}
