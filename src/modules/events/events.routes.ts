import type { FastifyInstance } from 'fastify';
import { optionalAuth, requireRole } from '../../plugins/auth';
import { toOpenApi, uuidParam } from '../../lib/validation';
import { createEventBody, listEventsQuery, seatLayoutBody, updateEventBody } from './events.schemas';
import { eventsController } from './events.controller';

const tags = ['Events'];
const secured = [{ bearerAuth: [] }];
const params = toOpenApi(uuidParam);

export async function eventsRoutes(app: FastifyInstance) {
  app.post(
    '/events',
    {
      schema: { tags, summary: 'Create a draft event (organiser)', security: secured, body: toOpenApi(createEventBody) },
      preHandler: requireRole('ORGANISER'),
    },
    eventsController.create,
  );

  app.patch(
    '/events/:id',
    {
      schema: { tags, summary: 'Edit your event (organiser)', security: secured, params, body: toOpenApi(updateEventBody) },
      preHandler: requireRole('ORGANISER'),
    },
    eventsController.update,
  );

  app.post(
    '/events/:id/publish',
    {
      schema: { tags, summary: 'Publish a draft event (organiser)', security: secured, params },
      preHandler: requireRole('ORGANISER'),
    },
    eventsController.publish,
  );

  app.get(
    '/events',
    {
      schema: {
        tags,
        summary: 'List published events (paginated, filter by date/venue/search)',
        querystring: toOpenApi(listEventsQuery),
      },
    },
    eventsController.list,
  );

  app.get(
    '/events/:id',
    {
      schema: { tags, summary: 'Get one event (drafts only visible to their organiser)', params },
      preHandler: optionalAuth,
    },
    eventsController.get,
  );

  app.post(
    '/events/:id/seats',
    {
      schema: {
        tags,
        summary: 'Bulk-create a seat layout, row by row (organiser)',
        security: secured,
        params,
        body: toOpenApi(seatLayoutBody),
      },
      preHandler: requireRole('ORGANISER'),
    },
    eventsController.addSeats,
  );

  app.get(
    '/events/:id/seats',
    {
      schema: { tags, summary: 'Seat map with live status: AVAILABLE / HELD / BOOKED', params },
      preHandler: optionalAuth,
    },
    eventsController.seatMap,
  );
}
