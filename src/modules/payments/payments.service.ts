import { randomUUID } from 'node:crypto';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { jobs } from '../../jobs/queue';
import { bookingsRepository } from '../bookings/bookings.repository';
import { bookingsService } from '../bookings/bookings.service';
import { signTicketToken } from '../tickets/qrToken';
import type { WebhookInput } from './payments.schemas';

export const paymentsService = {
  /**
   * Handles a verified payment webhook. Providers retry webhooks, so every
   * branch is idempotent: replaying the same event returns the same result.
   */
  async handleWebhook({ event, payload }: WebhookInput) {
    const booking = await bookingsRepository.findById(payload.bookingId);
    if (!booking) throw notFound('Booking');

    if (event === 'payment.failed') {
      const cancelled = await bookingsService.expireUnpaidBooking(booking.id);
      return { bookingId: booking.id, status: cancelled ? 'CANCELLED' : booking.status };
    }

    // payment.captured
    if (booking.status === 'CONFIRMED' && booking.paymentId === payload.paymentId) {
      return { bookingId: booking.id, status: 'CONFIRMED', duplicate: true };
    }
    if (booking.status !== 'PENDING') {
      // e.g. paid after the timeout already released the seats. A real system would refund here.
      logger.warn({ bookingId: booking.id, status: booking.status }, 'Payment for a booking that is not pending');
      throw conflict('BOOKING_NOT_PENDING', `Booking is ${booking.status}; payment cannot be applied`);
    }
    if (payload.amount !== booking.totalAmount) {
      throw badRequest('AMOUNT_MISMATCH', 'Paid amount does not match the booking total', {
        expected: booking.totalAmount,
        received: payload.amount,
      });
    }

    const tickets = booking.seats.map(({ seatId }) => {
      const id = randomUUID();
      return { id, seatId, qrToken: signTicketToken(id, booking.eventId) };
    });

    const confirmed = await bookingsRepository.confirmWithTickets(booking.id, payload.paymentId, tickets);
    if (!confirmed) {
      throw conflict('BOOKING_NOT_PENDING', 'Booking changed state while processing the payment');
    }
    await jobs.cancelPaymentTimeout(booking.id);
    return { bookingId: booking.id, status: 'CONFIRMED', tickets: tickets.length };
  },
};
