import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../../config';

/**
 * Razorpay-style webhook signature: hex HMAC-SHA256 of the raw request body,
 * keyed with a secret shared between us and the payment provider.
 * It must be computed over the exact bytes received — re-serialising the parsed
 * JSON could change whitespace or key order and break the signature.
 */
export function signPayload(rawBody: string): string {
  return createHmac('sha256', config.PAYMENT_WEBHOOK_SECRET).update(rawBody).digest('hex');
}

export function isValidSignature(rawBody: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = Buffer.from(signPayload(rawBody), 'hex');
  const received = Buffer.from(signature, 'hex');
  // Constant-time comparison so the signature can't be guessed byte by byte from response timings.
  return received.length === expected.length && timingSafeEqual(received, expected);
}
