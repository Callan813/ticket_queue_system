import './env/fast-timers'; // 1-second hold TTL — must be the first import
import type { FastifyInstance } from 'fastify';
import { api, closeConnections, createPublishedEvent, createTestApp, createUser, resetState } from './helpers';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Hold expiry (integration)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(resetState);
  afterAll(() => closeConnections(app));

  it('an expired hold becomes available again and can be held by someone else', async () => {
    const organiser = await createUser('ORGANISER');
    const alice = await createUser('ATTENDEE');
    const bob = await createUser('ATTENDEE');
    const event = await createPublishedEvent(organiser.id, 1, 2);
    const seat = event.seats[0];
    const seatStatus = async () =>
      (await api(app).get(`/api/v1/events/${event.id}/seats`)).body.seats.find(
        (s: { id: string }) => s.id === seat.id,
      ).status;

    const held = await api(app)
      .post(`/api/v1/events/${event.id}/holds`)
      .set(alice.auth)
      .send({ seatIds: [seat.id] })
      .expect(201);
    expect(await seatStatus()).toBe('HELD');
    await api(app).post(`/api/v1/events/${event.id}/holds`).set(bob.auth).send({ seatIds: [seat.id] }).expect(409);

    await sleep(1500); // TTL is 1s

    expect(await seatStatus()).toBe('AVAILABLE');
    // Alice can no longer book with her stale hold...
    const late = await api(app)
      .post('/api/v1/bookings')
      .set(alice.auth)
      .set('Idempotency-Key', 'too-late-key')
      .send({ holdId: held.body.hold.holdId })
      .expect(409);
    expect(late.body.error.code).toBe('HOLD_EXPIRED');
    // ...and Bob can now take the seat.
    await api(app).post(`/api/v1/events/${event.id}/holds`).set(bob.auth).send({ seatIds: [seat.id] }).expect(201);
  });
});
