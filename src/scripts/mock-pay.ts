/**
 * Plays the payment provider from the command line:
 *   npm run pay -- <bookingId> [fail]
 * Sends a correctly signed webhook to the running API.
 */
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { signPayload } from '../modules/payments/signature';

async function main() {
  const [bookingId, outcome] = process.argv.slice(2);
  if (!bookingId) throw new Error('Usage: npm run pay -- <bookingId> [fail]');

  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const body = JSON.stringify({
    event: outcome === 'fail' ? 'payment.failed' : 'payment.captured',
    payload: { bookingId, paymentId: `pay_cli_${Date.now()}`, amount: booking.totalAmount },
  });

  const res = await fetch(`http://localhost:${config.PORT}/api/v1/payments/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': signPayload(body) },
    body,
  });
  console.log(res.status, await res.text());
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
