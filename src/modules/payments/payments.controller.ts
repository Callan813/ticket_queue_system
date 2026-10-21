import type { FastifyRequest } from 'fastify';
import { AppError } from '../../lib/errors';
import { parse } from '../../lib/validation';
import { currentUser } from '../../plugins/auth';
import { bookingsService } from '../bookings/bookings.service';
import { SIGNATURE_HEADER, mockCheckoutBody, webhookBody, type WebhookInput } from './payments.schemas';
import { paymentsService } from './payments.service';
import { isValidSignature, signPayload } from './signature';

/** Verify first, parse second: unsigned input is never trusted. */
function processSignedWebhook(rawBody: string, signature: string | undefined) {
  if (!isValidSignature(rawBody, signature)) {
    throw new AppError(401, 'INVALID_SIGNATURE', 'Webhook signature is missing or invalid');
  }
  const input = parse(webhookBody, JSON.parse(rawBody));
  return paymentsService.handleWebhook(input);
}

export const paymentsController = {
  /** Called by the payment provider. Authenticated by signature, not by JWT. */
  async webhook(request: FastifyRequest) {
    const signature = request.headers[SIGNATURE_HEADER] as string | undefined;
    return processSignedWebhook(request.rawBody ?? '', signature);
  },

  /**
   * DEMO ONLY (MOCK_PAYMENTS_ENABLED): plays the role of the payment provider.
   * It builds and signs a webhook exactly as the provider would, then feeds it
   * through the same verification path as the real webhook route.
   */
  async mockCheckout(request: FastifyRequest) {
    const { bookingId, outcome } = parse(mockCheckoutBody, request.body);
    const booking = await bookingsService.getOwnBooking(currentUser(request), bookingId);

    const event: WebhookInput = {
      event: outcome === 'success' ? 'payment.captured' : 'payment.failed',
      payload: { bookingId, paymentId: `pay_mock_${Date.now()}`, amount: booking.totalAmount },
    };
    const rawBody = JSON.stringify(event);
    return processSignedWebhook(rawBody, signPayload(rawBody));
  },
};
