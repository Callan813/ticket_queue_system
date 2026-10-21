import type { FastifyReply, FastifyRequest } from 'fastify';
import { currentUser } from '../../plugins/auth';
import { parse, uuidParam } from '../../lib/validation';
import { createHoldBody, holdIdParam } from './holds.schemas';
import { holdsService } from './holds.service';

export const holdsController = {
  async create(request: FastifyRequest, reply: FastifyReply) {
    const { id: eventId } = parse(uuidParam, request.params);
    const { seatIds } = parse(createHoldBody, request.body);
    const hold = await holdsService.createHold(currentUser(request), eventId, seatIds);
    return reply.status(201).send({ hold });
  },

  async release(request: FastifyRequest, reply: FastifyReply) {
    const { holdId } = parse(holdIdParam, request.params);
    await holdsService.releaseHold(currentUser(request), holdId);
    return reply.status(204).send();
  },
};
