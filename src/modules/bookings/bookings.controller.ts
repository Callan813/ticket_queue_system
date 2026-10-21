import type { FastifyReply, FastifyRequest } from 'fastify';
import { currentUser } from '../../plugins/auth';
import { parse, uuidParam } from '../../lib/validation';
import { createBookingBody, idempotencyHeaders } from './bookings.schemas';
import { bookingsService, toBookingView } from './bookings.service';

export const bookingsController = {
  async create(request: FastifyRequest, reply: FastifyReply) {
    const { 'idempotency-key': idempotencyKey } = parse(idempotencyHeaders, request.headers);
    const { holdId } = parse(createBookingBody, request.body);

    const { booking, replayed } = await bookingsService.createBooking(currentUser(request), holdId, idempotencyKey);
    if (replayed) reply.header('Idempotent-Replayed', 'true');
    return reply.status(201).send({ booking: toBookingView(booking) });
  },

  async listMine(request: FastifyRequest) {
    const bookings = await bookingsService.listMyBookings(currentUser(request));
    return { bookings: bookings.map(toBookingView) };
  },

  async cancel(request: FastifyRequest) {
    const { id } = parse(uuidParam, request.params);
    const booking = await bookingsService.cancelBooking(currentUser(request), id);
    return { booking: toBookingView(booking) };
  },
};
