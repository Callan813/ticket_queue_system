import { randomUUID } from 'node:crypto';
import { config } from '../../config';
import { badRequest, conflict, notFound } from '../../lib/errors';
import type { AuthUser } from '../../lib/jwt';
import { logger } from '../../lib/logger';
import { jobs } from '../../jobs/queue';
import { publishSeatUpdates } from '../../realtime/seatUpdates';
import { bookingsRepository } from '../bookings/bookings.repository';
import { eventsRepository } from '../events/events.repository';
import { type HoldRecord, holdStore } from './hold.store';

const seatsUnavailable = (seatIds: string[]) =>
  conflict('SEATS_UNAVAILABLE', 'Some of these seats were just taken by someone else', { seatIds });

export const holdsService = {
  /**
   * Holds seats for HOLD_TTL_SECONDS so the user can check out.
   *
   * Order matters here:
   *  1. Grab the Redis locks (atomic, all-or-nothing).
   *  2. THEN check Postgres for an existing booking.
   * Checking the DB second closes a race: a booking deletes its Redis holds only
   * after its transaction commits, so if we managed to grab the lock, any booking
   * for that seat is already committed and visible to our DB check.
   */
  async createHold(user: AuthUser, eventId: string, seatIds: string[]) {
    const event = await eventsRepository.findById(eventId);
    if (!event || event.status === 'DRAFT') throw notFound('Event');
    if (event.status !== 'PUBLISHED' || event.startsAt <= new Date()) {
      throw conflict('EVENT_NOT_BOOKABLE', 'This event is not open for booking');
    }

    const seats = await eventsRepository.findSeatsByIds(eventId, seatIds);
    if (seats.length !== seatIds.length) {
      const found = new Set(seats.map((s) => s.id));
      throw badRequest('INVALID_SEATS', 'Some seats do not belong to this event', {
        seatIds: seatIds.filter((id) => !found.has(id)),
      });
    }

    const hold: HoldRecord = {
      holdId: randomUUID(),
      userId: user.id,
      eventId,
      seatIds: [...seatIds].sort(),
      expiresAt: new Date(Date.now() + config.HOLD_TTL_SECONDS * 1000).toISOString(),
    };

    // Step 1: Redis lock
    const taken = await holdStore.acquire(hold, config.HOLD_TTL_SECONDS);
    if (taken.length > 0) throw seatsUnavailable(taken);

    // Step 2: DB check (see comment above)
    const alreadyBooked = await bookingsRepository.findActiveSeatIds(seatIds);
    if (alreadyBooked.length > 0) {
      await holdStore.release(hold);
      throw seatsUnavailable(alreadyBooked);
    }

    await publishSeatUpdates(eventId, hold.seatIds, 'HELD');
    try {
      await jobs.scheduleHoldExpiry(
        { holdId: hold.holdId, eventId, seatIds: hold.seatIds },
        config.HOLD_TTL_SECONDS * 1000,
      );
    } catch (err) {
      // Not fatal: Redis TTL still frees the seats; only the live broadcast is lost.
      logger.warn({ err, holdId: hold.holdId }, 'Failed to schedule hold expiry job');
    }

    return {
      holdId: hold.holdId,
      eventId,
      expiresAt: hold.expiresAt,
      seats: seats.map((s) => ({ id: s.id, row: s.row, number: s.number, tier: s.tier, price: s.price })),
      totalAmount: seats.reduce((sum, s) => sum + s.price, 0),
    };
  },

  async releaseHold(user: AuthUser, holdId: string) {
    const hold = await holdStore.get(holdId);
    // Someone else's hold looks exactly like a missing one, so ids can't be probed.
    if (!hold || hold.userId !== user.id) throw notFound('Hold');

    const released = await holdStore.release(hold);
    await publishSeatUpdates(hold.eventId, released, 'AVAILABLE');
    await jobs.cancelHoldExpiry(holdId);
  },

  /**
   * Called by the hold-expiry job. Redis TTL has (almost certainly) already
   * removed the keys; this makes sure, then broadcasts the seats that are
   * genuinely free now — not ones that were booked or re-held by someone else.
   */
  async expireHold(holdId: string, eventId: string, seatIds: string[]) {
    await holdStore.release({ holdId, eventId, seatIds });
    const [booked, held] = await Promise.all([
      bookingsRepository.findActiveSeatIds(seatIds),
      holdStore.findHeldSeatIds(eventId, seatIds),
    ]);
    const nowFree = seatIds.filter((id) => !booked.includes(id) && !held.has(id));
    await publishSeatUpdates(eventId, nowFree, 'AVAILABLE');
    return nowFree;
  },
};
