import type { Prisma } from '@prisma/client';
import { conflict } from '../../lib/errors';
import { prisma } from '../../lib/prisma';

export const bookingInclude = {
  event: { select: { id: true, title: true, venue: true, startsAt: true } },
  seats: { include: { seat: true }, orderBy: [{ seat: { row: 'asc' } }, { seat: { number: 'asc' } }] },
} satisfies Prisma.BookingInclude;

export type BookingWithDetails = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

export interface NewBooking {
  userId: string;
  eventId: string;
  holdId: string;
  idempotencyKey: string;
  seatIds: string[];
}

export const bookingsRepository = {
  findById(id: string) {
    return prisma.booking.findUnique({ where: { id }, include: bookingInclude });
  },

  findByIdempotencyKey(userId: string, idempotencyKey: string) {
    return prisma.booking.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      include: bookingInclude,
    });
  },

  listForUser(userId: string) {
    return prisma.booking.findMany({
      where: { userId },
      include: bookingInclude,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  },

  /** Of these seats, which are in an active (pending or confirmed) booking? */
  async findActiveSeatIds(seatIds: string[]): Promise<string[]> {
    const rows = await prisma.bookingSeat.findMany({
      where: { seatId: { in: seatIds }, active: true },
      select: { seatId: true },
    });
    return rows.map((r) => r.seatId);
  },

  /**
   * Creates a PENDING booking and its BookingSeat rows in one transaction.
   *
   * The total is computed here from the prices in the database — the client
   * never sends a price. If any seat is already in an active booking, the
   * partial unique index on BookingSeat(seatId) makes the INSERT fail and the
   * whole transaction rolls back (caller turns that into a 409).
   */
  createPending(input: NewBooking) {
    return prisma.$transaction(async (tx) => {
      const seats = await tx.seat.findMany({ where: { id: { in: input.seatIds }, eventId: input.eventId } });
      if (seats.length !== input.seatIds.length) {
        throw conflict('INVALID_SEATS', 'Some held seats no longer exist');
      }
      const totalAmount = seats.reduce((sum, seat) => sum + seat.price, 0);

      return tx.booking.create({
        data: {
          userId: input.userId,
          eventId: input.eventId,
          holdId: input.holdId,
          idempotencyKey: input.idempotencyKey,
          totalAmount,
          status: 'PENDING',
          seats: { create: input.seatIds.map((seatId) => ({ seatId, eventId: input.eventId })) },
        },
        include: bookingInclude,
      });
    });
  },

  /**
   * PENDING -> CONFIRMED and issue one ticket per seat, in one transaction.
   * The status condition is part of the UPDATE, so a payment racing the
   * payment-timeout job can't both confirm and cancel the same booking.
   * Returns false if the booking was no longer PENDING.
   */
  confirmWithTickets(
    bookingId: string,
    paymentId: string,
    tickets: { id: string; seatId: string; qrToken: string }[],
  ) {
    return prisma.$transaction(async (tx) => {
      const { count } = await tx.booking.updateMany({
        where: { id: bookingId, status: 'PENDING' },
        data: { status: 'CONFIRMED', paymentId },
      });
      if (count === 0) return false;
      await tx.ticket.createMany({ data: tickets.map((t) => ({ ...t, bookingId })) });
      return true;
    });
  },

  /**
   * Cancels a booking if it is still in one of `fromStatuses`, and frees its seats.
   * The status check is part of the UPDATE, so two concurrent cancels (or a
   * cancel racing a payment) can't both win. Returns the freed seat ids, or
   * null if the booking was not in an allowed status.
   */
  cancel(bookingId: string, fromStatuses: ('PENDING' | 'CONFIRMED')[]) {
    return prisma.$transaction(async (tx) => {
      const { count } = await tx.booking.updateMany({
        where: { id: bookingId, status: { in: fromStatuses } },
        data: { status: 'CANCELLED' },
      });
      if (count === 0) return null;

      const seats = await tx.bookingSeat.findMany({ where: { bookingId, active: true }, select: { seatId: true } });
      await tx.bookingSeat.updateMany({ where: { bookingId }, data: { active: false } });
      return seats.map((s) => s.seatId);
    });
  },
};
