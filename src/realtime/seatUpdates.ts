import { logger } from '../lib/logger';
import { redis } from '../lib/redis';

export const SEAT_UPDATES_CHANNEL = 'seat-updates';

export type SeatStatus = 'AVAILABLE' | 'HELD' | 'BOOKED';

export interface SeatUpdateMessage {
  eventId: string;
  seats: { seatId: string; status: SeatStatus }[];
}

/**
 * Announces seat status changes on a Redis pub/sub channel. Every API instance
 * subscribes (see socket.ts) and forwards the message to browsers watching that
 * event, so this works no matter which instance or worker made the change.
 *
 * Best-effort: a failed broadcast must never fail the booking itself.
 */
export async function publishSeatUpdates(eventId: string, seatIds: string[], status: SeatStatus) {
  if (seatIds.length === 0) return;
  const message: SeatUpdateMessage = { eventId, seats: seatIds.map((seatId) => ({ seatId, status })) };
  try {
    await redis.publish(SEAT_UPDATES_CHANNEL, JSON.stringify(message));
  } catch (err) {
    logger.warn({ err, eventId }, 'Failed to publish seat update');
  }
}
