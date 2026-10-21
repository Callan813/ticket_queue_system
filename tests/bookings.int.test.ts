import type { FastifyInstance } from 'fastify';
import {
  api,
  closeConnections,
  createPublishedEvent,
  createTestApp,
  createUser,
  prisma,
  redis,
  resetState,
} from './helpers';

type TestUser = Awaited<ReturnType<typeof createUser>>;

describe('Holds & bookings (integration)', () => {
  let app: FastifyInstance;
  let organiser: TestUser;
  let alice: TestUser;
  let bob: TestUser;
  let event: Awaited<ReturnType<typeof createPublishedEvent>>;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetState();
    organiser = await createUser('ORGANISER');
    alice = await createUser('ATTENDEE', 'Alice');
    bob = await createUser('ATTENDEE', 'Bob');
    event = await createPublishedEvent(organiser.id);
  });
  afterAll(() => closeConnections(app));

  const hold = (user: TestUser, seatIds: string[]) =>
    api(app).post(`/api/v1/events/${event.id}/holds`).set(user.auth).send({ seatIds });

  const book = (user: TestUser, holdId: string, key = `key-${Math.random().toString(36).slice(2)}`) =>
    api(app).post('/api/v1/bookings').set(user.auth).set('Idempotency-Key', key).send({ holdId });

  const statusOf = async (seatId: string) => {
    const res = await api(app).get(`/api/v1/events/${event.id}/seats`).expect(200);
    return res.body.seats.find((s: { id: string }) => s.id === seatId).status;
  };

  it('happy path: hold -> book -> seat is BOOKED and listed in my bookings', async () => {
    const [s1, s2] = event.seats;
    const held = await hold(alice, [s1.id, s2.id]).expect(201);
    expect(held.body.hold.totalAmount).toBe(100000);
    expect(await statusOf(s1.id)).toBe('HELD');

    const booked = await book(alice, held.body.hold.holdId).expect(201);
    expect(booked.body.booking).toMatchObject({ status: 'PENDING', totalAmount: 100000 });
    expect(booked.body.booking.seats).toHaveLength(2);
    expect(await statusOf(s1.id)).toBe('BOOKED');

    // The Redis hold was consumed — the DB now protects these seats.
    expect(await redis.exists(`seat:${event.id}:${s1.id}`)).toBe(0);

    const mine = await api(app).get('/api/v1/bookings/me').set(alice.auth).expect(200);
    expect(mine.body.bookings.map((b: { id: string }) => b.id)).toEqual([booked.body.booking.id]);
  });

  it('computes the total from DB prices, ignoring anything the client sends', async () => {
    const seat = event.seats[0];
    const held = await api(app)
      .post(`/api/v1/events/${event.id}/holds`)
      .set(alice.auth)
      .send({ seatIds: [seat.id], price: 1, totalAmount: 1 })
      .expect(201);
    const booked = await book(alice, held.body.hold.holdId).expect(201);
    expect(booked.body.booking.totalAmount).toBe(50000);
  });

  it('returns 409 with the taken seat ids when a seat is already held', async () => {
    const [s1, s2] = event.seats;
    await hold(alice, [s1.id]).expect(201);
    const res = await hold(bob, [s1.id, s2.id]).expect(409);
    expect(res.body.error).toMatchObject({ code: 'SEATS_UNAVAILABLE', details: { seatIds: [s1.id] } });
  });

  it('is all-or-nothing: a failed multi-seat hold holds none of the seats', async () => {
    const [s1, s2, s3] = event.seats;
    await hold(alice, [s2.id]).expect(201);
    await hold(bob, [s1.id, s2.id, s3.id]).expect(409);
    expect(await statusOf(s1.id)).toBe('AVAILABLE');
    expect(await statusOf(s3.id)).toBe('AVAILABLE');
    await hold(bob, [s1.id, s3.id]).expect(201);
  });

  it('cannot hold a seat that is already booked', async () => {
    const seat = event.seats[0];
    const held = await hold(alice, [seat.id]).expect(201);
    await book(alice, held.body.hold.holdId).expect(201);
    const res = await hold(bob, [seat.id]).expect(409);
    expect(res.body.error.details.seatIds).toEqual([seat.id]);
  });

  it('rejects seats from another event', async () => {
    const other = await createPublishedEvent(organiser.id, 1, 1);
    const res = await hold(alice, [other.seats[0].id]).expect(400);
    expect(res.body.error.code).toBe('INVALID_SEATS');
  });

  it('releasing a hold frees the seats; only the owner can release it', async () => {
    const seat = event.seats[0];
    const held = await hold(alice, [seat.id]).expect(201);
    const holdId = held.body.hold.holdId;

    await api(app).delete(`/api/v1/holds/${holdId}`).set(bob.auth).expect(404);
    await api(app).delete(`/api/v1/holds/${holdId}`).set(alice.auth).expect(204);
    expect(await statusOf(seat.id)).toBe('AVAILABLE');
    await hold(bob, [seat.id]).expect(201);
  });

  it("cannot book someone else's hold", async () => {
    const held = await hold(alice, [event.seats[0].id]).expect(201);
    const res = await book(bob, held.body.hold.holdId).expect(409);
    expect(res.body.error.code).toBe('HOLD_EXPIRED');
  });

  it('rejects booking a hold whose seat keys have expired', async () => {
    const seat = event.seats[0];
    const held = await hold(alice, [seat.id]).expect(201);
    await redis.del(`seat:${event.id}:${seat.id}`); // simulate TTL expiry of the seat lock
    const res = await book(alice, held.body.hold.holdId).expect(409);
    expect(res.body.error.code).toBe('HOLD_EXPIRED');
  });

  it('only organisers can create events, only attendees can hold seats', async () => {
    await hold(organiser, [event.seats[0].id]).expect(403);
  });

  describe('idempotency', () => {
    it('replays the original booking for the same key instead of booking twice', async () => {
      const held = await hold(alice, [event.seats[0].id]).expect(201);
      const first = await book(alice, held.body.hold.holdId, 'checkout-123').expect(201);
      const second = await book(alice, held.body.hold.holdId, 'checkout-123').expect(201);

      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.body.booking).toEqual(first.body.booking);
      expect(await prisma.booking.count()).toBe(1);
    });

    it('rejects reusing a key for a different hold', async () => {
      const h1 = await hold(alice, [event.seats[0].id]).expect(201);
      const h2 = await hold(alice, [event.seats[1].id]).expect(201);
      await book(alice, h1.body.hold.holdId, 'checkout-abc').expect(201);
      const res = await book(alice, h2.body.hold.holdId, 'checkout-abc').expect(422);
      expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('scopes keys per user', async () => {
      const h1 = await hold(alice, [event.seats[0].id]).expect(201);
      const h2 = await hold(bob, [event.seats[1].id]).expect(201);
      await book(alice, h1.body.hold.holdId, 'same-key-1').expect(201);
      await book(bob, h2.body.hold.holdId, 'same-key-1').expect(201);
      expect(await prisma.booking.count()).toBe(2);
    });

    it('requires the Idempotency-Key header', async () => {
      const held = await hold(alice, [event.seats[0].id]).expect(201);
      const res = await api(app)
        .post('/api/v1/bookings')
        .set(alice.auth)
        .send({ holdId: held.body.hold.holdId })
        .expect(400);
      expect(res.body.error.details[0].path).toBe('idempotency-key');
    });
  });

  describe('cancellation', () => {
    it('frees the seats so someone else can book them', async () => {
      const seat = event.seats[0];
      const held = await hold(alice, [seat.id]).expect(201);
      const booked = await book(alice, held.body.hold.holdId).expect(201);

      const cancelled = await api(app)
        .post(`/api/v1/bookings/${booked.body.booking.id}/cancel`)
        .set(alice.auth)
        .expect(200);
      expect(cancelled.body.booking.status).toBe('CANCELLED');
      expect(await statusOf(seat.id)).toBe('AVAILABLE');

      const bobHold = await hold(bob, [seat.id]).expect(201);
      await book(bob, bobHold.body.hold.holdId).expect(201);
    });

    it('cannot cancel twice or cancel someone else’s booking', async () => {
      const held = await hold(alice, [event.seats[0].id]).expect(201);
      const { id } = (await book(alice, held.body.hold.holdId).expect(201)).body.booking;
      await api(app).post(`/api/v1/bookings/${id}/cancel`).set(bob.auth).expect(404);
      await api(app).post(`/api/v1/bookings/${id}/cancel`).set(alice.auth).expect(200);
      const again = await api(app).post(`/api/v1/bookings/${id}/cancel`).set(alice.auth).expect(409);
      expect(again.body.error.code).toBe('BOOKING_NOT_CANCELLABLE');
    });
  });
});
