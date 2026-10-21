import { z } from 'zod';

/**
 * All configuration comes from environment variables and is validated once at
 * startup. A missing or malformed value crashes the process immediately with a
 * readable message, instead of failing later in some request.
 */
const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('1h'),
  QR_SECRET: z.string().min(32, 'QR_SECRET must be at least 32 characters'),
  PAYMENT_WEBHOOK_SECRET: z.string().min(32, 'PAYMENT_WEBHOOK_SECRET must be at least 32 characters'),

  HOLD_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  MAX_SEATS_PER_HOLD: z.coerce.number().int().positive().default(10),
  PAYMENT_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(600),

  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_AUTH_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_BOOKING_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_BOOKING_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),

  /** Run the BullMQ worker inside the API process (simplest for a single container). */
  RUN_WORKER: bool.default(true),
  /** Exposes POST /payments/mock-checkout so the demo page can "pay". Never enable in real prod. */
  MOCK_PAYMENTS_ENABLED: bool,
  /** Seed demo data on startup if the database is empty. */
  SEED_ON_START: bool,
});

export type Config = z.infer<typeof envSchema>;

function loadConfig(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${problems}`);
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();
