import type { FastifyReply, FastifyRequest } from 'fastify';
import { currentUser } from '../../plugins/auth';
import { parse, uuidParam } from '../../lib/validation';
import { createEventBody, listEventsQuery, seatLayoutBody, updateEventBody } from './events.schemas';
import { eventsService } from './events.service';

export const eventsController = {
  async create(request: FastifyRequest, reply: FastifyReply) {
    const input = parse(createEventBody, request.body);
    const event = await eventsService.createEvent(currentUser(request), input);
    return reply.status(201).send({ event });
  },

  async update(request: FastifyRequest) {
    const { id } = parse(uuidParam, request.params);
    const input = parse(updateEventBody, request.body);
    return { event: await eventsService.updateEvent(currentUser(request), id, input) };
  },

  async publish(request: FastifyRequest) {
    const { id } = parse(uuidParam, request.params);
    return { event: await eventsService.publishEvent(currentUser(request), id) };
  },

  async list(request: FastifyRequest) {
    const query = parse(listEventsQuery, request.query);
    return eventsService.listEvents(query);
  },

  async get(request: FastifyRequest) {
    const { id } = parse(uuidParam, request.params);
    return { event: await eventsService.getEvent(id, request.user) };
  },

  async addSeats(request: FastifyRequest, reply: FastifyReply) {
    const { id } = parse(uuidParam, request.params);
    const layout = parse(seatLayoutBody, request.body);
    return reply.status(201).send(await eventsService.addSeats(currentUser(request), id, layout));
  },

  async seatMap(request: FastifyRequest) {
    const { id } = parse(uuidParam, request.params);
    return eventsService.getSeatMap(id, request.user);
  },
};
