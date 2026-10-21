import type { FastifyInstance } from 'fastify';
import { requireRole } from '../../plugins/auth';
import { toOpenApi, uuidParam } from '../../lib/validation';
import { verifyTicketBody } from './tickets.schemas';
import { ticketsController } from './tickets.controller';

export async function ticketsRoutes(app: FastifyInstance) {
  app.get(
    '/bookings/:id/tickets',
    {
      schema: {
        tags: ['Tickets'],
        summary: 'Tickets (with QR codes) for a confirmed booking',
        security: [{ bearerAuth: [] }],
        params: toOpenApi(uuidParam),
      },
      preHandler: requireRole('ATTENDEE'),
    },
    ticketsController.list,
  );

  app.post(
    '/tickets/verify',
    {
      schema: {
        tags: ['Tickets'],
        summary: 'Scan a ticket at the gate (organiser). A second scan is rejected.',
        security: [{ bearerAuth: [] }],
        body: toOpenApi(verifyTicketBody),
      },
      preHandler: requireRole('ORGANISER'),
    },
    ticketsController.verify,
  );
}
