/** Unit tests for QR check-in logic with the repository mocked. */
import { ticketsService } from '../../src/modules/tickets/tickets.service';
import { ticketsRepository } from '../../src/modules/tickets/tickets.repository';
import { signTicketToken } from '../../src/modules/tickets/qrToken';

jest.mock('../../src/modules/tickets/tickets.repository');
jest.mock('../../src/lib/redis', () => ({ redis: { defineCommand: jest.fn() }, createRedisConnection: jest.fn() }));

const repo = jest.mocked(ticketsRepository);
const organiser = { id: 'org-1', role: 'ORGANISER' as const };
const token = signTicketToken('ticket-1', 'event-1');

function ticket(overrides: { status?: string; organiserId?: string; qrToken?: string } = {}) {
  return {
    id: 'ticket-1',
    qrToken: overrides.qrToken ?? token,
    checkedInAt: null,
    seat: { row: 'A', number: 3, tier: 'VIP' },
    booking: {
      status: overrides.status ?? 'CONFIRMED',
      eventId: 'event-1',
      user: { name: 'Alice' },
      event: { title: 'Fest', organiserId: overrides.organiserId ?? 'org-1' },
    },
  } as never;
}

beforeEach(() => jest.resetAllMocks());

describe('ticketsService.checkIn', () => {
  it('checks a valid ticket in', async () => {
    repo.findForCheckIn.mockResolvedValue(ticket());
    repo.markCheckedIn.mockResolvedValue(true);

    const result = await ticketsService.checkIn(organiser, token);
    expect(result).toMatchObject({ ticketId: 'ticket-1', attendee: 'Alice', seat: { row: 'A', number: 3 } });
    expect(repo.markCheckedIn).toHaveBeenCalledWith('ticket-1');
  });

  it('rejects a second scan of the same ticket', async () => {
    repo.findForCheckIn.mockResolvedValue(ticket());
    repo.markCheckedIn.mockResolvedValue(false); // the conditional UPDATE matched nothing

    await expect(ticketsService.checkIn(organiser, token)).rejects.toMatchObject({
      statusCode: 409,
      code: 'ALREADY_CHECKED_IN',
    });
  });

  it("rejects tickets for another organiser's event", async () => {
    repo.findForCheckIn.mockResolvedValue(ticket({ organiserId: 'org-2' }));
    await expect(ticketsService.checkIn(organiser, token)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.markCheckedIn).not.toHaveBeenCalled();
  });

  it('rejects tickets of a cancelled booking', async () => {
    repo.findForCheckIn.mockResolvedValue(ticket({ status: 'CANCELLED' }));
    await expect(ticketsService.checkIn(organiser, token)).rejects.toMatchObject({ code: 'TICKET_NOT_VALID' });
  });

  it('rejects a validly signed token that is not the one stored for this ticket', async () => {
    repo.findForCheckIn.mockResolvedValue(ticket({ qrToken: 'a-different-token' }));
    await expect(ticketsService.checkIn(organiser, token)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects a forged token before touching the database', async () => {
    await expect(ticketsService.checkIn(organiser, 'forged.token.value')).rejects.toMatchObject({
      code: 'INVALID_TICKET',
    });
    expect(repo.findForCheckIn).not.toHaveBeenCalled();
  });
});
