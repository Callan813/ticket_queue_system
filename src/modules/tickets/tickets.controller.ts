import type { FastifyRequest } from 'fastify';
import { currentUser } from '../../plugins/auth';
import { parse, uuidParam } from '../../lib/validation';
import { verifyTicketBody } from './tickets.schemas';
import { ticketsService } from './tickets.service';

export const ticketsController = {
  async list(request: FastifyRequest) {
    const { id } = parse(uuidParam, request.params);
    return { tickets: await ticketsService.getBookingTickets(currentUser(request), id) };
  },

  async verify(request: FastifyRequest) {
    const { qrToken } = parse(verifyTicketBody, request.body);
    return { checkIn: await ticketsService.checkIn(currentUser(request), qrToken) };
  },
};
