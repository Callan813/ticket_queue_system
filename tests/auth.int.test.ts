import type { FastifyInstance } from 'fastify';
import { api, closeConnections, createTestApp, createUser, resetState } from './helpers';

describe('Auth (integration)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(resetState);
  afterAll(() => closeConnections(app));

  it('registers, logs in and returns the current user', async () => {
    const reg = await api(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Asha', email: 'Asha@Example.com', password: 'supersecret' })
      .expect(201);
    expect(reg.body.user).toMatchObject({ name: 'Asha', email: 'asha@example.com', role: 'ATTENDEE' });
    expect(reg.body.user.passwordHash).toBeUndefined();

    const login = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: 'asha@example.com', password: 'supersecret' })
      .expect(200);
    expect(login.body.token).toEqual(expect.any(String));

    const me = await api(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.token}`)
      .expect(200);
    expect(me.body.user.email).toBe('asha@example.com');
  });

  it('rejects a duplicate email with 409', async () => {
    const body = { name: 'A', email: 'dup@example.com', password: 'supersecret' };
    await api(app).post('/api/v1/auth/register').send(body).expect(201);
    const res = await api(app).post('/api/v1/auth/register').send(body).expect(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects wrong passwords with a generic message', async () => {
    await api(app)
      .post('/api/v1/auth/register')
      .send({ name: 'A', email: 'a@example.com', password: 'supersecret' });
    const res = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: 'a@example.com', password: 'nope' })
      .expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns validation errors in the standard format', async () => {
    const res = await api(app).post('/api/v1/auth/register').send({ email: 'not-an-email' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'email' }),
        expect.objectContaining({ path: 'name' }),
      ]),
    );
  });

  it('requires a valid token for /auth/me', async () => {
    await api(app).get('/api/v1/auth/me').expect(401);
    await api(app).get('/api/v1/auth/me').set('Authorization', 'Bearer garbage').expect(401);
    const user = await createUser();
    await api(app).get('/api/v1/auth/me').set(user.auth).expect(200);
  });

  it('echoes a request id header', async () => {
    const res = await api(app).get('/health').set('x-request-id', 'abc-123').expect(200);
    expect(res.headers['x-request-id']).toBe('abc-123');
  });
});
