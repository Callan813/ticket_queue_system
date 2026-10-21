import type { Event } from '@prisma/client';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import type { AuthUser } from '../../lib/jwt';
import { isUniqueViolation } from '../../lib/prisma';
import type { SeatStatus } from '../../realtime/seatUpdates';
import { holdStore } from '../holds/hold.store';
import { eventsRepository } from './events.repository';
import type { CreateEventInput, ListEventsQuery, SeatLayoutInput, UpdateEventInput } from './events.schemas';

/** Loads an event the given organiser owns, or throws 404/403. */
async function getOwnedEvent(user: AuthUser, eventId: string): Promise<Event> {
  const event = await eventsRepository.findById(eventId);
  if (!event) throw notFound('Event');
  if (event.organiserId !== user.id) throw forbidden('You can only manage your own events');
  return event;
}

/** Drafts are only visible to the organiser who owns them. */
function canView(event: Event, user?: AuthUser) {
  return event.status !== 'DRAFT' || event.organiserId === user?.id;
}

export const eventsService = {
  createEvent(user: AuthUser, input: CreateEventInput) {
    return eventsRepository.create(user.id, input);
  },

  async updateEvent(user: AuthUser, eventId: string, input: UpdateEventInput) {
    const event = await getOwnedEvent(user, eventId);
    if (event.status === 'CANCELLED') throw conflict('EVENT_CANCELLED', 'Cancelled events cannot be edited');
    return eventsRepository.update(eventId, input);
  },

  async publishEvent(user: AuthUser, eventId: string) {
    const event = await getOwnedEvent(user, eventId);
    if (event.status !== 'DRAFT') {
      throw conflict('INVALID_EVENT_STATUS', `Only draft events can be published (status is ${event.status})`);
    }
    if (event.startsAt <= new Date()) throw badRequest('EVENT_IN_PAST', 'Cannot publish an event that has started');
    if ((await eventsRepository.countSeats(eventId)) === 0) {
      throw badRequest('NO_SEATS', 'Add a seat layout before publishing');
    }
    return eventsRepository.update(eventId, { status: 'PUBLISHED' });
  },

  async listEvents(query: ListEventsQuery) {
    const { items, total } = await eventsRepository.listPublished(query);
    return {
      data: items,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  },

  async getEvent(eventId: string, user?: AuthUser) {
    const event = await eventsRepository.findById(eventId);
    if (!event || !canView(event, user)) throw notFound('Event');
    return event;
  },

  async addSeats(user: AuthUser, eventId: string, layout: SeatLayoutInput) {
    const event = await getOwnedEvent(user, eventId);
    if (event.status === 'CANCELLED') throw conflict('EVENT_CANCELLED', 'Cannot add seats to a cancelled event');

    const seats = layout.rows.flatMap((r) =>
      Array.from({ length: r.seats }, (_, i) => ({
        eventId,
        row: r.row,
        number: r.startNumber + i,
        tier: r.tier,
        price: r.price,
      })),
    );

    try {
      const { count } = await eventsRepository.createSeats(seats);
      return { created: count };
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw conflict('SEAT_EXISTS', 'One or more of these seats already exist for this event');
      }
      throw err;
    }
  },

  /**
   * Every seat with its live status. BOOKED comes from Postgres (the source of
   * truth); HELD comes from the temporary holds in Redis (see holds module).
   */
  async getSeatMap(eventId: string, user?: AuthUser) {
    await this.getEvent(eventId, user);
    const seats = await eventsRepository.findSeats(eventId);
    const [booked, held] = await Promise.all([
      eventsRepository.findBookedSeatIds(eventId),
      holdStore.findHeldSeatIds(
        eventId,
        seats.map((s) => s.id),
      ),
    ]);

    return {
      eventId,
      seats: seats.map((s) => ({
        id: s.id,
        row: s.row,
        number: s.number,
        tier: s.tier,
        price: s.price,
        status: (booked.has(s.id) ? 'BOOKED' : held.has(s.id) ? 'HELD' : 'AVAILABLE') as SeatStatus,
      })),
    };
  },
};
