import jwt from 'jsonwebtoken';
import { signTicketToken, verifyTicketToken } from '../../src/modules/tickets/qrToken';
import { signAccessToken } from '../../src/lib/jwt';

describe('QR ticket tokens', () => {
  it('round-trips ticket and event ids', () => {
    const token = signTicketToken('ticket-1', 'event-1');
    expect(verifyTicketToken(token)).toEqual({ ticketId: 'ticket-1', eventId: 'event-1' });
  });

  it('rejects a token whose payload was tampered with', () => {
    const [header, , signature] = signTicketToken('ticket-1', 'event-1').split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ tid: 'ticket-2', eid: 'event-1', typ: 'ticket' })).toString(
      'base64url',
    );
    expect(() => verifyTicketToken(`${header}.${forgedPayload}.${signature}`)).toThrow(
      expect.objectContaining({ code: 'INVALID_TICKET' }),
    );
  });

  it('rejects a token signed with a different secret', () => {
    const token = jwt.sign({ tid: 't', eid: 'e', typ: 'ticket' }, 'some-other-secret-that-is-long-enough!!');
    expect(() => verifyTicketToken(token)).toThrow(expect.objectContaining({ code: 'INVALID_TICKET' }));
  });

  it('does not accept a login token as a ticket', () => {
    const loginToken = signAccessToken({ id: 'user-1', role: 'ATTENDEE' });
    expect(() => verifyTicketToken(loginToken)).toThrow(expect.objectContaining({ code: 'INVALID_TICKET' }));
  });

  it('rejects garbage', () => {
    expect(() => verifyTicketToken('not-a-token')).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
});
