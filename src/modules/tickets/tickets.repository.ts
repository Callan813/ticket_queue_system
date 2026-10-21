import { prisma } from '../../lib/prisma';

export const ticketsRepository = {
  findByBooking(bookingId: string) {
    return prisma.ticket.findMany({
      where: { bookingId },
      include: { seat: true },
      orderBy: [{ seat: { row: 'asc' } }, { seat: { number: 'asc' } }],
    });
  },

  findForCheckIn(ticketId: string) {
    return prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        seat: true,
        booking: { select: { status: true, eventId: true, user: { select: { name: true } }, event: true } },
      },
    });
  },

  /**
   * Marks the ticket as used. The `checkedInAt: null` condition is evaluated in
   * the same UPDATE, so if the same QR is scanned at two gates simultaneously,
   * exactly one scan updates the row and the other sees count 0.
   */
  async markCheckedIn(ticketId: string): Promise<boolean> {
    const { count } = await prisma.ticket.updateMany({
      where: { id: ticketId, checkedInAt: null },
      data: { checkedInAt: new Date() },
    });
    return count === 1;
  },
};
