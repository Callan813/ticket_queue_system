/**
 * The core guarantee: two users can never book the same seat, even at the same instant.
 *
 * Each test fires N requests "simultaneously" (Promise.all) and asserts that
 * exactly one wins. The last test bypasses Redis entirely to prove the
 * database constraint alone is enough.
 */
import type { FastifyInstance } from 'fastify';
import { bookingsRepository } from '../src/modules/bookings/bookings.repository';
import { isUniqueViolation } from '../src/lib/prisma';
import {
  api,
  closeConnections,
  createPublishedEvent,
  createTestApp,
  createUser,
  prisma,
  resetState,
} from './helpers';

const N = 20;

describe('Concurrency: double booking is impossible', () => {
  let app: FastifyInstance;
  let event: Awaited<ReturnType<typeof createPublishedEvent>>;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetState();
    const organiser = await createUser('ORGANISER');
    event = await createPublishedEvent(organiser.id, 1, 3);
  });
  afterAll(() => closeConnections(app));

  const countStatuses = (statuses: number[]) =>
    statuses.reduce<Record<number, number>>((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {});

  it(`${N} users try to hold the same seat at once: exactly 1 succeeds, ${N - 1} get 409`, async () => {
    const seat = event.seats[0];
    const users = await Promise.all(Array.from({ length: N }, () => createUser('ATTENDEE')));

    const responses = await Promise.all(
      users.map((u) =>
        api(app).post(`/api/v1/events/${event.id}/holds`).set(u.auth).send({ seatIds: [seat.id] }),
      ),
    );

    expect(countStatuses(responses.map((r) => r.status))).toEqual({ 201: 1, 409: N - 1 });
  });

  it(`${N} users each hold-then-book the same seat at once: exactly 1 booking exists`, async () => {
    const seat = event.seats[0];
    const users = await Promise.all(Array.from({ length: N }, () => createUser('ATTENDEE')));

    const results = await Promise.all(
      users.map(async (u, i) => {
        const held = await api(app)
          .post(`/api/v1/events/${event.id}/holds`)
          .set(u.auth)
          .send({ seatIds: [seat.id] });
        if (held.status !== 201) return held.status;
        const booked = await api(app)
          .post('/api/v1/bookings')
          .set(u.auth)
          .set('Idempotency-Key', `race-${i}-xyz`)
          .send({ holdId: held.body.hold.holdId });
        return booked.status;
      }),
    );

    expect(countStatuses(results)).toEqual({ 201: 1, 409: N - 1 });
    expect(await prisma.bookingSeat.count({ where: { seatId: seat.id, active: true } })).toBe(1);
  });

  it(`${N} booking requests for one hold (different keys): exactly 1 succeeds`, async () => {
    const user = await createUser('ATTENDEE');
    const held = await api(app)
      .post(`/api/v1/events/${event.id}/holds`)
      .set(user.auth)
      .send({ seatIds: [event.seats[0].id] })
      .expect(201);

    const responses = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        api(app)
          .post('/api/v1/bookings')
          .set(user.auth)
          .set('Idempotency-Key', `different-key-${i}`)
          .send({ holdId: held.body.hold.holdId }),
      ),
    );

    expect(countStatuses(responses.map((r) => r.status))).toEqual({ 201: 1, 409: N - 1 });
    expect(await prisma.booking.count()).toBe(1);
  });

  it(`${N} retries with the SAME Idempotency-Key all get the same booking`, async () => {
    const user = await createUser('ATTENDEE');
    const held = await api(app)
      .post(`/api/v1/events/${event.id}/holds`)
      .set(user.auth)
      .send({ seatIds: [event.seats[0].id] })
      .expect(201);

    const responses = await Promise.all(
      Array.from({ length: N }, () =>
        api(app)
          .post('/api/v1/bookings')
          .set(user.auth)
          .set('Idempotency-Key', 'double-click-retry')
          .send({ holdId: held.body.hold.holdId }),
      ),
    );

    expect(responses.map((r) => r.status)).toEqual(Array(N).fill(201));
    expect(new Set(responses.map((r) => r.body.booking.id)).size).toBe(1);
    expect(await prisma.booking.count()).toBe(1);
  });

  it('database safety net: even with Redis bypassed, only one insert can win', async () => {
    const seat = event.seats[0];
    const users = await Promise.all(Array.from({ length: N }, () => createUser('ATTENDEE')));

    // Call the repository directly, skipping holds entirely, as if Redis had failed.
    const results = await Promise.allSettled(
      users.map((u, i) =>
        bookingsRepository.createPending({
          userId: u.id,
          eventId: event.id,
          holdId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          idempotencyKey: `no-redis-${i}`,
          seatIds: [seat.id],
        }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(N - 1);
    expect(rejected.every((r) => isUniqueViolation(r.reason))).toBe(true);
  });
});
