import type { FastifyInstance } from 'fastify';
import { signPayload } from '../src/modules/payments/signature';
import {
  api,
  closeConnections,
  createPublishedEvent,
  createTestApp,
  createUser,
  prisma,
  resetState,
} from './helpers';

type TestUser = Awaited<ReturnType<typeof createUser>>;

describe('Payments, tickets & check-in (integration)', () => {
  let app: FastifyInstance;
  let organiser: TestUser;
  let alice: TestUser;
  let event: Awaited<ReturnType<typeof createPublishedEvent>>;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetState();
    organiser = await createUser('ORGANISER');
    alice = await createUser('ATTENDEE', 'Alice');
    event = await createPublishedEvent(organiser.id);
  });
  afterAll(() => closeConnections(app));

  /** Holds and books two seats for Alice; returns the PENDING booking. */
  async function pendingBooking() {
    const held = await api(app)
      .post(`/api/v1/events/${event.id}/holds`)
      .set(alice.auth)
      .send({ seatIds: [event.seats[0].id, event.seats[1].id] })
      .expect(201);
    const res = await api(app)
      .post('/api/v1/bookings')
      .set(alice.auth)
      .set('Idempotency-Key', `pay-test-${Date.now()}`)
      .send({ holdId: held.body.hold.holdId })
      .expect(201);
    return res.body.booking as { id: string; totalAmount: number };
  }

  function sendWebhook(body: object, signature?: string) {
    const raw = JSON.stringify(body);
    return api(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', signature ?? signPayload(raw))
      .send(raw);
  }

  const captured = (bookingId: string, amount: number, paymentId = 'pay_123') => ({
    event: 'payment.captured',
    payload: { bookingId, paymentId, amount },
  });

  it('rejects webhooks with a missing or wrong signature', async () => {
    const booking = await pendingBooking();
    const body = captured(booking.id, booking.totalAmount);

    await api(app).post('/api/v1/payments/webhook').send(body).expect(401);
    const res = await sendWebhook(body, signPayload('{"something":"else"}')).expect(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    expect((await prisma.booking.findUnique({ where: { id: booking.id } }))!.status).toBe('PENDING');
  });

  it('confirms the booking and issues one ticket per seat; webhook retries are harmless', async () => {
    const booking = await pendingBooking();

    // Tickets don't exist before payment
    await api(app).get(`/api/v1/bookings/${booking.id}/tickets`).set(alice.auth).expect(409);

    const first = await sendWebhook(captured(booking.id, booking.totalAmount)).expect(200);
    expect(first.body).toMatchObject({ status: 'CONFIRMED', tickets: 2 });

    const retry = await sendWebhook(captured(booking.id, booking.totalAmount)).expect(200);
    expect(retry.body).toMatchObject({ status: 'CONFIRMED', duplicate: true });
    expect(await prisma.ticket.count()).toBe(2);

    const tickets = await api(app).get(`/api/v1/bookings/${booking.id}/tickets`).set(alice.auth).expect(200);
    expect(tickets.body.tickets).toHaveLength(2);
    expect(tickets.body.tickets[0].qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('rejects a payment for the wrong amount', async () => {
    const booking = await pendingBooking();
    const res = await sendWebhook(captured(booking.id, 1)).expect(400);
    expect(res.body.error).toMatchObject({ code: 'AMOUNT_MISMATCH', details: { expected: 100000, received: 1 } });
  });

  it('payment.failed cancels the booking and frees the seats', async () => {
    const booking = await pendingBooking();
    await sendWebhook({ event: 'payment.failed', payload: { bookingId: booking.id, paymentId: 'p', amount: 0 } }).expect(
      200,
    );
    const seats = await api(app).get(`/api/v1/events/${event.id}/seats`).expect(200);
    expect(seats.body.seats.slice(0, 2).map((s: { status: string }) => s.status)).toEqual(['AVAILABLE', 'AVAILABLE']);
  });

  it('mock checkout (demo) goes through the real signed webhook path', async () => {
    const booking = await pendingBooking();
    const res = await api(app)
      .post('/api/v1/payments/mock-checkout')
      .set(alice.auth)
      .send({ bookingId: booking.id })
      .expect(200);
    expect(res.body.status).toBe('CONFIRMED');
  });

  describe('check-in at the gate', () => {
    async function paidTicketToken() {
      const booking = await pendingBooking();
      await sendWebhook(captured(booking.id, booking.totalAmount)).expect(200);
      const tickets = await api(app).get(`/api/v1/bookings/${booking.id}/tickets`).set(alice.auth).expect(200);
      return tickets.body.tickets[0].qrToken as string;
    }

    it('admits a ticket once and rejects the second scan', async () => {
      const qrToken = await paidTicketToken();

      const first = await api(app).post('/api/v1/tickets/verify').set(organiser.auth).send({ qrToken }).expect(200);
      expect(first.body.checkIn).toMatchObject({ attendee: 'Alice', seat: { row: 'A', number: 1 } });

      const second = await api(app).post('/api/v1/tickets/verify').set(organiser.auth).send({ qrToken }).expect(409);
      expect(second.body.error.code).toBe('ALREADY_CHECKED_IN');
      expect(second.body.error.details.checkedInAt).toEqual(expect.any(String));
    });

    it('two gates scanning the same ticket at once: exactly one admits it', async () => {
      const qrToken = await paidTicketToken();
      const scans = await Promise.all(
        Array.from({ length: 10 }, () =>
          api(app).post('/api/v1/tickets/verify').set(organiser.auth).send({ qrToken }),
        ),
      );
      expect(scans.filter((r) => r.status === 200)).toHaveLength(1);
      expect(scans.filter((r) => r.status === 409)).toHaveLength(9);
    });

    it("only the event's organiser can scan, and attendees can't at all", async () => {
      const qrToken = await paidTicketToken();
      const otherOrganiser = await createUser('ORGANISER');
      await api(app).post('/api/v1/tickets/verify').set(otherOrganiser.auth).send({ qrToken }).expect(403);
      await api(app).post('/api/v1/tickets/verify').set(alice.auth).send({ qrToken }).expect(403);
    });

    it('rejects tickets of a cancelled booking', async () => {
      const qrToken = await paidTicketToken();
      const booking = await prisma.booking.findFirstOrThrow();
      await api(app).post(`/api/v1/bookings/${booking.id}/cancel`).set(alice.auth).expect(200);
      const res = await api(app).post('/api/v1/tickets/verify').set(organiser.auth).send({ qrToken }).expect(409);
      expect(res.body.error.code).toBe('TICKET_NOT_VALID');
    });
  });
});
