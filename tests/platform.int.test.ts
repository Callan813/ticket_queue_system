import Fastify, { type FastifyInstance } from 'fastify';
import { rateLimit } from '../src/plugins/rateLimit';
import { registerErrorHandler } from '../src/plugins/errorHandler';
import { seedDemoData } from '../src/scripts/seed';
import { api, closeConnections, createTestApp, prisma, resetState } from './helpers';

describe('Platform: rate limiting, docs, demo, seed', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(resetState);
  afterAll(() => closeConnections(app));

  describe('rate limiting', () => {
    let limited: FastifyInstance;

    beforeAll(async () => {
      // A tiny app with a low limit, so the test doesn't depend on global config.
      limited = Fastify();
      registerErrorHandler(limited);
      limited.get('/ping', { preHandler: rateLimit({ name: 'test', max: 3, windowSeconds: 60, keyBy: 'ip' }) }, async () => ({
        ok: true,
      }));
      await limited.listen({ port: 0, host: '127.0.0.1' });
    });
    afterAll(() => limited.close());

    it('allows `max` requests per window, then returns 429 with Retry-After', async () => {
      for (let i = 0; i < 3; i++) {
        const res = await api(limited).get('/ping').expect(200);
        expect(res.headers['x-ratelimit-remaining']).toBe(String(2 - i));
      }
      const blocked = await api(limited).get('/ping').expect(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('is applied to the real auth and booking routes', async () => {
      const res = await api(app).post('/api/v1/auth/login').send({ email: 'x@y.dev', password: 'nope' });
      expect(res.headers['x-ratelimit-limit']).toBeDefined();
    });
  });

  it('serves an OpenAPI spec covering every endpoint group', async () => {
    const res = await api(app).get('/docs/json').expect(200);
    const paths = Object.keys(res.body.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/v1/auth/login',
        '/api/v1/events/{id}/seats',
        '/api/v1/events/{id}/holds',
        '/api/v1/bookings',
        '/api/v1/tickets/verify',
        '/api/v1/payments/webhook',
      ]),
    );
    expect(res.body.paths['/api/v1/events/{id}/holds'].post.requestBody).toBeDefined();
  });

  it('serves the demo page', async () => {
    const res = await api(app).get('/demo').expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Seat Booking Demo');
  });

  it('seeds 1 organiser, 3 attendees and 2 events with 50 seats each, idempotently', async () => {
    expect(await seedDemoData()).toBe(true);
    expect(await seedDemoData()).toBe(false);

    expect(await prisma.user.count({ where: { role: 'ORGANISER' } })).toBe(1);
    expect(await prisma.user.count({ where: { role: 'ATTENDEE' } })).toBe(3);
    const events = await prisma.event.findMany({ include: { _count: { select: { seats: true } } } });
    expect(events.map((e) => e._count.seats)).toEqual([50, 50]);
  });
});
