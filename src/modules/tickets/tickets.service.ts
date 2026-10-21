import QRCode from 'qrcode';
import { conflict, forbidden, notFound } from '../../lib/errors';
import type { AuthUser } from '../../lib/jwt';
import { bookingsService } from '../bookings/bookings.service';
import { verifyTicketToken } from './qrToken';
import { ticketsRepository } from './tickets.repository';

export const ticketsService = {
  /** The tickets of one of my confirmed bookings, each with a scannable QR image. */
  async getBookingTickets(user: AuthUser, bookingId: string) {
    const booking = await bookingsService.getOwnBooking(user, bookingId);
    if (booking.status !== 'CONFIRMED') {
      throw conflict('BOOKING_NOT_CONFIRMED', `Tickets are issued once payment is confirmed (status is ${booking.status})`);
    }

    const tickets = await ticketsRepository.findByBooking(bookingId);
    return Promise.all(
      tickets.map(async (t) => ({
        id: t.id,
        seat: { row: t.seat.row, number: t.seat.number, tier: t.seat.tier },
        qrToken: t.qrToken,
        qrCodeDataUrl: await QRCode.toDataURL(t.qrToken, { margin: 1, width: 256 }),
        checkedInAt: t.checkedInAt,
      })),
    );
  },

  /** Gate scan: validates the signed token, then checks the ticket in exactly once. */
  async checkIn(organiser: AuthUser, qrToken: string) {
    const { ticketId, eventId } = verifyTicketToken(qrToken);

    const ticket = await ticketsRepository.findForCheckIn(ticketId);
    if (!ticket || ticket.qrToken !== qrToken || ticket.booking.eventId !== eventId) throw notFound('Ticket');
    if (ticket.booking.event.organiserId !== organiser.id) {
      throw forbidden('This ticket is for an event you do not organise');
    }
    if (ticket.booking.status !== 'CONFIRMED') {
      throw conflict('TICKET_NOT_VALID', `This ticket's booking is ${ticket.booking.status}`);
    }

    const firstScan = await ticketsRepository.markCheckedIn(ticketId);
    if (!firstScan) {
      const current = await ticketsRepository.findForCheckIn(ticketId);
      throw conflict('ALREADY_CHECKED_IN', 'This ticket has already been used', {
        checkedInAt: current?.checkedInAt,
      });
    }

    return {
      ticketId,
      attendee: ticket.booking.user.name,
      event: ticket.booking.event.title,
      seat: { row: ticket.seat.row, number: ticket.seat.number, tier: ticket.seat.tier },
      checkedInAt: new Date(),
    };
  },
};
