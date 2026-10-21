// Runs before any test module is imported, so src/config.ts sees these values.
// Tests use a separate Postgres database and Redis DB index from the demo app.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://ticketing:ticketing@localhost:5432/ticketing_test';
process.env.REDIS_URL ??= 'redis://localhost:6379/1';
process.env.JWT_SECRET ??= 'test-jwt-secret-0123456789abcdef0123456789';
process.env.QR_SECRET ??= 'test-qr-secret-0123456789abcdef0123456789ab';
process.env.PAYMENT_WEBHOOK_SECRET ??= 'test-webhook-secret-0123456789abcdef01234';
process.env.RUN_WORKER = 'false';
process.env.MOCK_PAYMENTS_ENABLED = 'true';
// Generous limits so normal tests never trip them; the rate-limit test lowers them explicitly.
process.env.RATE_LIMIT_AUTH_MAX ??= '1000';
process.env.RATE_LIMIT_BOOKING_MAX ??= '1000';
