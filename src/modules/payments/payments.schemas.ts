import { z } from 'zod';

export const SIGNATURE_HEADER = 'x-razorpay-signature';

/** Simplified Razorpay-style webhook payload. */
export const webhookBody = z.object({
  event: z.enum(['payment.captured', 'payment.failed']),
  payload: z.object({
    bookingId: z.string().uuid(),
    paymentId: z.string().min(1).max(100),
    /** Minor units; must match the booking total exactly. */
    amount: z.number().int().nonnegative(),
  }),
});

export const mockCheckoutBody = z.object({
  bookingId: z.string().uuid(),
  outcome: z.enum(['success', 'failure']).default('success'),
});

export type WebhookInput = z.infer<typeof webhookBody>;
