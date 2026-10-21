import './env/fast-timers'; // 1-second hold TTL and payment timeout — must be the first import
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { startWorker } from '../src/jobs/worker';
import type { SeatUpdateMessage } from '../src/realtime/seatUpdates';
import {
  api,
  closeConnections,
  createPublishedEvent,
  createTestApp,
  createUser,
  prisma,
  resetState,
} from './helpers';

describe('Real-time seat updates & background jobs (integration)', () => {
  let app: FastifyInstance;
  let worker: ReturnType<typeof startWorker>;
  let socket: Socket;
  let event: Awaited<ReturnType<typeof createPublishedEvent>>;
  let alice: Awaited<ReturnType<typeof createUser>>;
  let updates: SeatUpdateMessage[];

  beforeAll(async () => {
    app = await createTestApp();
    worker = startWorker();
  });
  beforeEach(async () => {
    await resetState();
    const organiser = await createUser('ORGANISER');
    alice = await createUser('ATTENDEE');
    event = await createPublishedEvent(organiser.id, 1, 3);

    updates = [];
    const { port } = app.server.address() as AddressInfo;
    socket = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
    socket.on('seat-update', (msg: SeatUpdateMessage) => updates.push(msg));
    await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
    socket.emit('join-event', event.id);
    await new Promise((r) => setTimeout(r, 100)); // let the join land
  });
  afterEach(() => {
    socket.disconnect();
  });
  afterAll(async () => {
    await worker.close();
    await closeConnections(app);
  });

  /** Polls until the predicate holds (or fails after `timeoutMs`). */
  async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (!(await predicate())) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  const statusesFor = (seatId: string) =>
    updates.flatMap((u) => u.seats.filter((s) => s.seatId === seatId).map((s) => s.status));

  it('pushes HELD then BOOKED to everyone watching the event', async () => {
    const seat = event.seats[0];
    const held = await api(app)
      .post(`/api/v1/events/${event.id}/holds`)
      .set(alice.auth)
      .send({ seatIds: [seat.id] })
      .expect(201);
    await api(app)
      .post('/api/v1/bookings')
      .set(alice.auth)
      .set('Idempotency-Key', 'realtime-test-1')
      .send({ holdId: held.body.hold.holdId })
      .expect(201);

    await waitFor(() => statusesFor(seat.id).length >= 2);
    expect(statusesFor(seat.id)).toEqual(['HELD', 'BOOKED']);
  });

  it('the expiry job releases an abandoned hold and broadcasts AVAILABLE', async () => {
    const seat = event.seats[1];
    await api(app).post(`/api/v1/events/${event.id}/holds`).set(alice.auth).send({ seatIds: [seat.id] }).expect(201);

    await waitFor(() => statusesFor(seat.id).includes('AVAILABLE'));
    expect(statusesFor(seat.id)).toEqual(['HELD', 'AVAILABLE']);
  });

  it('the payment-timeout job cancels an unpaid booking and frees its seats', async () => {
    const seat = event.seats[2];
    const held = await api(app)
      .post(`/api/v1/events/${event.id}/holds`)
      .set(alice.auth)
      .send({ seatIds: [seat.id] })
      .expect(201);
    const booked = await api(app)
      .post('/api/v1/bookings')
      .set(alice.auth)
      .set('Idempotency-Key', 'realtime-test-2')
      .send({ holdId: held.body.hold.holdId })
      .expect(201);

    await waitFor(async () => {
      const b = await prisma.booking.findUnique({ where: { id: booked.body.booking.id } });
      return b?.status === 'CANCELLED';
    });
    await waitFor(() => statusesFor(seat.id).includes('AVAILABLE'));
    expect(statusesFor(seat.id)).toEqual(['HELD', 'BOOKED', 'AVAILABLE']);
  });

  it('does not send updates for other events', async () => {
    const other = await createPublishedEvent((await createUser('ORGANISER')).id, 1, 1);
    await api(app)
      .post(`/api/v1/events/${other.id}/holds`)
      .set(alice.auth)
      .send({ seatIds: [other.seats[0].id] })
      .expect(201);
    await new Promise((r) => setTimeout(r, 300));
    expect(updates).toHaveLength(0);
  });
});
