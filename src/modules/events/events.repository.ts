import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import type { CreateEventInput, ListEventsQuery, UpdateEventInput } from './events.schemas';

const seatOrder: Prisma.SeatOrderByWithRelationInput[] = [{ row: 'asc' }, { number: 'asc' }];

export const eventsRepository = {
  create(organiserId: string, input: CreateEventInput) {
    return prisma.event.create({ data: { ...input, organiserId } });
  },

  findById(id: string) {
    return prisma.event.findUnique({ where: { id } });
  },

  update(id: string, data: UpdateEventInput & { status?: 'PUBLISHED' | 'CANCELLED' }) {
    return prisma.event.update({ where: { id }, data });
  },

  async listPublished(query: ListEventsQuery) {
    const where: Prisma.EventWhereInput = {
      status: 'PUBLISHED',
      startsAt: { gte: query.from, lte: query.to },
      venue: query.venue ? { contains: query.venue, mode: 'insensitive' } : undefined,
      OR: query.search
        ? [
            { title: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
          ]
        : undefined,
    };

    const [items, total] = await prisma.$transaction([
      prisma.event.findMany({
        where,
        orderBy: { startsAt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.event.count({ where }),
    ]);
    return { items, total };
  },

  countSeats(eventId: string) {
    return prisma.seat.count({ where: { eventId } });
  },

  createSeats(seats: Prisma.SeatCreateManyInput[]) {
    return prisma.seat.createMany({ data: seats });
  },

  findSeatsByIds(eventId: string, seatIds: string[]) {
    return prisma.seat.findMany({ where: { eventId, id: { in: seatIds } }, orderBy: seatOrder });
  },

  findSeats(eventId: string) {
    return prisma.seat.findMany({ where: { eventId }, orderBy: seatOrder });
  },

  /** Seats of this event that belong to an active (pending or confirmed) booking. */
  async findBookedSeatIds(eventId: string): Promise<Set<string>> {
    const rows = await prisma.bookingSeat.findMany({
      where: { eventId, active: true },
      select: { seatId: true },
    });
    return new Set(rows.map((r) => r.seatId));
  },
};
