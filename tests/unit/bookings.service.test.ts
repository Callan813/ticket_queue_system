/**
 * Unit tests for the booking service. Every dependency (DB, Redis, queue,
 * pub/sub) is mocked, so these run without infrastructure and pin down the
 * decision logic: hold ownership, idempotency, and mapping DB races to 409s.
 */
import { Prisma } from '@prisma/client';
import { bookingsService } from '../../src/modules/bookings/bookings.service';
import { bookingsRepository } from '../../src/modules/bookings/bookings.repository';
import { holdStore } from '../../src/modules/holds/hold.store';
import { jobs } from '../../src/jobs/queue';
import { publishSeatUpdates } from '../../src/realtime/seatUpdates';

jest.mock('../../src/modules/bookings/bookings.repository');
jest.mock('../../src/modules/holds/hold.store');
jest.mock('../../src/jobs/queue');
jest.mock('../../src/realtime/seatUpdates');
// The real modules open connections at import time; mocks above replace them, these stop the rest.
jest.mock('../../src/lib/redis', () => ({ redis: { defineCommand: jest.fn() }, createRedisConnection: jest.fn() }));

const repo = jest.mocked(bookingsRepository);
const holds = jest.mocked(holdStore);
const publish = jest.mocked(publishSeatUpdates);
const queue = jest.mocked(jobs);

const user = { id: 'user-1', role: 'ATTENDEE' as const };
const hold = {
  holdId: 'hold-1',
  userId: 'user-1',
  eventId: 'event-1',
  seatIds: ['seat-1', 'seat-2'],
  expiresAt: new Date().toISOString(),
};
const booking = { id: 'booking-1', holdId: 'hold-1', eventId: 'event-1', status: 'PENDING' } as never;

function uniqueViolation(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  repo.findByIdempotencyKey.mockResolvedValue(null);
  holds.get.mockResolvedValue(hold);
  holds.isFullyHeld.mockResolvedValue(true);
  repo.createPending.mockResolvedValue(booking);
});

describe('bookingsService.createBooking', () => {
  it('creates a pending booking from a valid hold, then cleans up', async () => {
    const result = await bookingsService.createBooking(user, 'hold-1', 'key-1');

    expect(result).toEqual({ booking, replayed: false });
    expect(repo.createPending).toHaveBeenCalledWith({
      userId: 'user-1',
      eventId: 'event-1',
      holdId: 'hold-1',
      idempotencyKey: 'key-1',
      seatIds: ['seat-1', 'seat-2'],
    });
    expect(holds.release).toHaveBeenCalledWith(hold);
    expect(publish).toHaveBeenCalledWith('event-1', ['seat-1', 'seat-2'], 'BOOKED');
    expect(queue.schedulePaymentTimeout).toHaveBeenCalledWith({ bookingId: 'booking-1' }, expect.any(Number));
  });

  it("rejects a hold that belongs to someone else", async () => {
    holds.get.mockResolvedValue({ ...hold, userId: 'someone-else' });
    await expect(bookingsService.createBooking(user, 'hold-1', 'key-1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'HOLD_EXPIRED',
    });
    expect(repo.createPending).not.toHaveBeenCalled();
  });

  it('rejects a hold whose seats are no longer all held', async () => {
    holds.isFullyHeld.mockResolvedValue(false);
    await expect(bookingsService.createBooking(user, 'hold-1', 'key-1')).rejects.toMatchObject({
      code: 'HOLD_EXPIRED',
    });
    expect(repo.createPending).not.toHaveBeenCalled();
  });

  it('maps a seat unique violation (the DB safety net) to 409 SEATS_ALREADY_BOOKED', async () => {
    repo.createPending.mockRejectedValue(uniqueViolation(['BookingSeat_seatId_active_key']));
    await expect(bookingsService.createBooking(user, 'hold-1', 'key-1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'SEATS_ALREADY_BOOKED',
    });
    expect(publish).not.toHaveBeenCalled();
    expect(holds.release).not.toHaveBeenCalled();
  });
});

describe('idempotency', () => {
  it('returns the existing booking for a repeated key without touching the hold', async () => {
    repo.findByIdempotencyKey.mockResolvedValue(booking);
    const result = await bookingsService.createBooking(user, 'hold-1', 'key-1');

    expect(result).toEqual({ booking, replayed: true });
    expect(holds.get).not.toHaveBeenCalled();
    expect(repo.createPending).not.toHaveBeenCalled();
  });

  it('rejects the same key used for a different hold with 422', async () => {
    repo.findByIdempotencyKey.mockResolvedValue(booking);
    await expect(bookingsService.createBooking(user, 'hold-OTHER', 'key-1')).rejects.toMatchObject({
      statusCode: 422,
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
  });

  it('when a concurrent same-key request wins the insert race, replays the winner', async () => {
    repo.findByIdempotencyKey
      .mockResolvedValueOnce(null) // before: nothing yet
      .mockResolvedValueOnce(booking); // after the failure: the winner's booking
    repo.createPending.mockRejectedValue(uniqueViolation(['userId', 'idempotencyKey']));

    const result = await bookingsService.createBooking(user, 'hold-1', 'key-1');
    expect(result).toEqual({ booking, replayed: true });
  });

  it('when a concurrent same-key request already consumed the hold, replays the winner', async () => {
    repo.findByIdempotencyKey.mockResolvedValueOnce(null).mockResolvedValueOnce(booking);
    holds.get.mockResolvedValue(null); // the winner released the hold

    const result = await bookingsService.createBooking(user, 'hold-1', 'key-1');
    expect(result).toEqual({ booking, replayed: true });
  });

  it('still surfaces the real error when there is no winner to replay', async () => {
    holds.get.mockResolvedValue(null);
    await expect(bookingsService.createBooking(user, 'hold-1', 'key-1')).rejects.toMatchObject({
      code: 'HOLD_EXPIRED',
    });
  });
});

describe('bookingsService.expireUnpaidBooking', () => {
  it('cancels a still-pending booking and announces the freed seats', async () => {
    repo.findById.mockResolvedValue({ id: 'booking-1', eventId: 'event-1' } as never);
    repo.cancel.mockResolvedValue(['seat-1']);

    await expect(bookingsService.expireUnpaidBooking('booking-1')).resolves.toBe(true);
    expect(repo.cancel).toHaveBeenCalledWith('booking-1', ['PENDING']);
    expect(publish).toHaveBeenCalledWith('event-1', ['seat-1'], 'AVAILABLE');
  });

  it('does nothing if the booking was paid in the meantime', async () => {
    repo.findById.mockResolvedValue({ id: 'booking-1', eventId: 'event-1' } as never);
    repo.cancel.mockResolvedValue(null);

    await expect(bookingsService.expireUnpaidBooking('booking-1')).resolves.toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });
});
