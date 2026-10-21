import { z } from 'zod';

export const createBookingBody = z.object({
  holdId: z.string().uuid(),
});

export const idempotencyHeaders = z.object({
  'idempotency-key': z
    .string({ error: 'The Idempotency-Key header is required' })
    .trim()
    .min(8, 'Idempotency-Key must be at least 8 characters')
    .max(100)
    .regex(/^[A-Za-z0-9_.:-]+$/, 'Idempotency-Key may only contain letters, digits and _ . : -'),
});
