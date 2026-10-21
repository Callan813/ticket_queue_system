import type { FastifyInstance } from 'fastify';
import { api, closeConnections, createTestApp, createUser, prisma, resetState } from './helpers';

const inDays = (days: number) => new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();

describe('Events & seats (integration)', () => {
  let app: FastifyInstance;
  let organiser: Awaited<ReturnType<typeof createUser>>;
  let attendee: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetState();
    organiser = await createUser('ORGANISER');
    attendee = await createUser('ATTENDEE');
  });
  afterAll(() => closeConnections(app));

  async function createDraft(overrides: Record<string, unknown> = {}) {
    const res = await api(app)
      .post('/api/v1/events')
      .set(organiser.auth)
      .send({ title: 'Hack Night', venue: 'Auditorium', startsAt: inDays(7), ...overrides })
      .expect(201);
    return res.body.event;
  }

  it('lets an organiser create, lay out seats, and publish an event', async () => {
    const event = await createDraft();
    expect(event.status).toBe('DRAFT');

    // Can't publish without seats
    const noSeats = await api(app).post(`/api/v1/events/${event.id}/publish`).set(organiser.auth).expect(400);
    expect(noSeats.body.error.code).toBe('NO_SEATS');

    const layout = await api(app)
      .post(`/api/v1/events/${event.id}/seats`)
      .set(organiser.auth)
      .send({
        rows: [
          { row: 'a', seats: 5, tier: 'VIP', price: 150000 },
          { row: 'B', seats: 10, tier: 'STANDARD', price: 50000 },
        ],
      })
      .expect(201);
    expect(layout.body.created).toBe(15);

    const published = await api(app).post(`/api/v1/events/${event.id}/publish`).set(organiser.auth).expect(200);
    expect(published.body.event.status).toBe('PUBLISHED');

    const map = await api(app).get(`/api/v1/events/${event.id}/seats`).expect(200);
    expect(map.body.seats).toHaveLength(15);
    expect(map.body.seats[0]).toMatchObject({ row: 'A', number: 1, tier: 'VIP', price: 150000, status: 'AVAILABLE' });
  });

  it('rejects duplicate seats with 409', async () => {
    const event = await createDraft();
    const body = { rows: [{ row: 'A', seats: 3, tier: 'STANDARD', price: 100 }] };
    await api(app).post(`/api/v1/events/${event.id}/seats`).set(organiser.auth).send(body).expect(201);
    const res = await api(app).post(`/api/v1/events/${event.id}/seats`).set(organiser.auth).send(body).expect(409);
    expect(res.body.error.code).toBe('SEAT_EXISTS');
  });

  it('enforces roles and ownership', async () => {
    await api(app)
      .post('/api/v1/events')
      .set(attendee.auth)
      .send({ title: 'Nope', venue: 'Nowhere', startsAt: inDays(1) })
      .expect(403);

    const event = await createDraft();
    const otherOrganiser = await createUser('ORGANISER');
    await api(app).patch(`/api/v1/events/${event.id}`).set(otherOrganiser.auth).send({ title: 'Mine now' }).expect(403);
    await api(app).patch(`/api/v1/events/${event.id}`).set(organiser.auth).send({ title: 'Renamed' }).expect(200);
  });

  it('hides drafts from everyone except their organiser', async () => {
    const event = await createDraft();
    await api(app).get(`/api/v1/events/${event.id}`).expect(404);
    await api(app).get(`/api/v1/events/${event.id}`).set(attendee.auth).expect(404);
    await api(app).get(`/api/v1/events/${event.id}`).set(organiser.auth).expect(200);
  });

  it('rejects events in the past', async () => {
    const res = await api(app)
      .post('/api/v1/events')
      .set(organiser.auth)
      .send({ title: 'Old', venue: 'Somewhere', startsAt: '2020-01-01T00:00:00Z' })
      .expect(400);
    expect(res.body.error.details[0].path).toBe('startsAt');
  });

  describe('listing', () => {
    beforeEach(async () => {
      const base = { organiserId: organiser.id, status: 'PUBLISHED' as const };
      await prisma.event.createMany({
        data: [
          { ...base, title: 'Robotics Expo', venue: 'Hall A', startsAt: inDays(1) },
          { ...base, title: 'Music Fest', venue: 'Open Grounds', startsAt: inDays(10), description: 'Live bands' },
          { ...base, title: 'Hackathon', venue: 'Hall B', startsAt: inDays(20) },
          { ...base, title: 'Secret Draft', venue: 'Hall A', startsAt: inDays(2), status: 'DRAFT' },
        ],
      });
    });

    it('paginates published events, soonest first', async () => {
      const page1 = await api(app).get('/api/v1/events?pageSize=2').expect(200);
      expect(page1.body.data.map((e: { title: string }) => e.title)).toEqual(['Robotics Expo', 'Music Fest']);
      expect(page1.body.meta).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });

      const page2 = await api(app).get('/api/v1/events?pageSize=2&page=2').expect(200);
      expect(page2.body.data.map((e: { title: string }) => e.title)).toEqual(['Hackathon']);
    });

    it('filters by venue, search and date range', async () => {
      const byVenue = await api(app).get('/api/v1/events?venue=hall').expect(200);
      expect(byVenue.body.meta.total).toBe(2);

      const bySearch = await api(app).get('/api/v1/events?search=bands').expect(200);
      expect(bySearch.body.data[0].title).toBe('Music Fest');

      const byDate = await api(app).get(`/api/v1/events?from=${inDays(5)}&to=${inDays(15)}`).expect(200);
      expect(byDate.body.data.map((e: { title: string }) => e.title)).toEqual(['Music Fest']);
    });

    it('validates query params', async () => {
      const res = await api(app).get('/api/v1/events?pageSize=500').expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
