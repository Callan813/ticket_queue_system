import { config } from '../../config';
import { AppError, conflict, notFound } from '../../lib/errors';
import type { AuthUser } from '../../lib/jwt';
import { logger } from '../../lib/logger';
import { isUniqueViolation, uniqueViolationTarget } from '../../lib/prisma';
import { jobs } from '../../jobs/queue';
import { publishSeatUpdates } from '../../realtime/seatUpdates';
import { holdStore } from '../holds/hold.store';
import { type BookingWithDetails, bookingsRepository } from './bookings.repository';

/** The shape clients see. Prices are in minor units. */
export function toBookingView(booking: BookingWithDetails) {
  return {
    id: booking.id,
    status: booking.status,
    totalAmount: booking.totalAmount,
    event: booking.event,
    seats: booking.seats.map(({ seat }) => ({
      id: seat.id,
      row: seat.row,
      number: seat.number,
      tier: seat.tier,
      price: seat.price,
    })),
    createdAt: booking.createdAt,
    paymentDueBy:
      booking.status === 'PENDING'
        ? new Date(booking.createdAt.getTime() + config.PAYMENT_TIMEOUT_SECONDS * 1000)
        : null,
  };
}

/** Same key + same hold = the original booking. Same key + different hold = client bug. */
function replay(existing: BookingWithDetails, holdId: string) {
  if (existing.holdId !== holdId) {
    throw new AppError(
      422,
      'IDEMPOTENCY_KEY_REUSED',
      'This Idempotency-Key was already used for a different request',
    );
  }
  return { booking: existing, replayed: true };
}

/**
 * Turns a hold into a PENDING booking. The seats are now protected by the
 * database (partial unique index), so the Redis hold is no longer needed.
 */
async function createBookingFromHold(user: AuthUser, holdId: string, idempotencyKey: string) {
  const hold = await holdStore.get(holdId);
  if (!hold || hold.userId !== user.id) {
    throw conflict('HOLD_EXPIRED', 'This hold has expired or does not exist. Please select your seats again.');
  }
  // Every seat key must still point at this hold (none expired and got re-held).
  if (!(await holdStore.isFullyHeld(hold))) {
    throw conflict('HOLD_EXPIRED', 'Part of this hold has expired. Please select your seats again.');
  }

  let booking: BookingWithDetails;
  try {
    booking = await bookingsRepository.createPending({
      userId: user.id,
      eventId: hold.eventId,
      holdId,
      idempotencyKey,
      seatIds: hold.seatIds,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      if (uniqueViolationTarget(err).includes('idempotency')) {
        // A concurrent request with the same key committed first; the caller replays it.
        throw conflict('IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is already being processed');
      }
      // The database safety net fired: one of these seats is already booked.
      throw conflict('SEATS_ALREADY_BOOKED', 'One or more of these seats have already been booked');
    }
    throw err;
  }

  // Post-commit housekeeping. None of this affects correctness if it fails.
  await holdStore.release(hold);
  await publishSeatUpdates(hold.eventId, hold.seatIds, 'BOOKED');
  await jobs.cancelHoldExpiry(holdId);
  try {
    await jobs.schedulePaymentTimeout({ bookingId: booking.id }, config.PAYMENT_TIMEOUT_SECONDS * 1000);
  } catch (err) {
    logger.error({ err, bookingId: booking.id }, 'Failed to schedule payment timeout');
  }

  return booking;
}

export const bookingsService = {
  /**
   * POST /bookings — idempotent. Retrying with the same Idempotency-Key (a
   * double-click, a network retry) returns the original booking instead of
   * creating a second one.
   */
  async createBooking(user: AuthUser, holdId: string, idempotencyKey: string) {
    const existing = await bookingsRepository.findByIdempotencyKey(user.id, idempotencyKey);
    if (existing) return replay(existing, holdId);

    try {
      return { booking: await createBookingFromHold(user, holdId, idempotencyKey), replayed: false };
    } catch (err) {
      // If two requests with the same key raced, the loser fails (hold already
      // consumed, or unique key violation). Return the winner's booking instead.
      const winner = await bookingsRepository.findByIdempotencyKey(user.id, idempotencyKey);
      if (winner) return replay(winner, holdId);
      throw err;
    }
  },

  async listMyBookings(user: AuthUser) {
    return bookingsRepository.listForUser(user.id);
  },

  /** Loads a booking that belongs to this user (others' bookings look like 404s). */
  async getOwnBooking(user: AuthUser, bookingId: string) {
    const booking = await bookingsRepository.findById(bookingId);
    if (!booking || booking.userId !== user.id) throw notFound('Booking');
    return booking;
  },

  async cancelBooking(user: AuthUser, bookingId: string) {
    const booking = await this.getOwnBooking(user, bookingId);
    if (booking.event.startsAt <= new Date()) {
      throw conflict('EVENT_STARTED', 'Bookings cannot be cancelled after the event has started');
    }

    const freedSeatIds = await bookingsRepository.cancel(bookingId, ['PENDING', 'CONFIRMED']);
    if (!freedSeatIds) throw conflict('BOOKING_NOT_CANCELLABLE', `Booking is already ${booking.status}`);

    await publishSeatUpdates(booking.eventId, freedSeatIds, 'AVAILABLE');
    await jobs.cancelPaymentTimeout(bookingId);
    return (await bookingsRepository.findById(bookingId))!;
  },

  /** Called by the payment-timeout job: cancels a booking that was never paid. */
  async expireUnpaidBooking(bookingId: string) {
    const booking = await bookingsRepository.findById(bookingId);
    if (!booking) return false;
    const freedSeatIds = await bookingsRepository.cancel(bookingId, ['PENDING']);
    if (!freedSeatIds) return false; // already paid or cancelled — nothing to do
    await publishSeatUpdates(booking.eventId, freedSeatIds, 'AVAILABLE');
    return true;
  },
};
