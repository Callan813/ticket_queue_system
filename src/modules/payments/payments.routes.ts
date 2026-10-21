import type { FastifyInstance } from 'fastify';
import { config } from '../../config';
import { requireRole } from '../../plugins/auth';
import { toOpenApi } from '../../lib/validation';
import { mockCheckoutBody, webhookBody } from './payments.schemas';
import { paymentsController } from './payments.controller';

export async function paymentsRoutes(app: FastifyInstance) {
  app.post(
    '/payments/webhook',
    {
      schema: {
        tags: ['Payments'],
        summary: 'Payment provider webhook (HMAC-SHA256 of the raw body in X-Razorpay-Signature)',
        body: toOpenApi(webhookBody),
      },
    },
    paymentsController.webhook,
  );

  // Demo-only route; it doesn't exist at all unless explicitly enabled.
  if (!config.MOCK_PAYMENTS_ENABLED) return;
  app.post(
    '/payments/mock-checkout',
    {
      schema: {
        tags: ['Payments'],
        summary: 'DEMO ONLY: simulate paying for a booking (needs MOCK_PAYMENTS_ENABLED=true)',
        security: [{ bearerAuth: [] }],
        body: toOpenApi(mockCheckoutBody),
      },
      preHandler: requireRole('ATTENDEE'),
    },
    paymentsController.mockCheckout,
  );
}
