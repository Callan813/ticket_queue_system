import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { badRequest } from '../../lib/errors';

/**
 * A ticket's QR code encodes a JWT signed with QR_SECRET (a different secret
 * from login tokens). Anyone can read the ticket id inside, but nobody can
 * forge or alter one without the secret — so the scanner can trust it offline,
 * and the database check-in prevents reuse.
 */
interface TicketClaims {
  tid: string; // ticket id
  eid: string; // event id
  typ: 'ticket';
}

export function signTicketToken(ticketId: string, eventId: string): string {
  const claims: TicketClaims = { tid: ticketId, eid: eventId, typ: 'ticket' };
  return jwt.sign(claims, config.QR_SECRET, { algorithm: 'HS256' });
}

export function verifyTicketToken(token: string): { ticketId: string; eventId: string } {
  try {
    const claims = jwt.verify(token, config.QR_SECRET, { algorithms: ['HS256'] }) as TicketClaims;
    if (claims.typ !== 'ticket' || !claims.tid || !claims.eid) throw new Error('wrong token type');
    return { ticketId: claims.tid, eventId: claims.eid };
  } catch {
    throw badRequest('INVALID_TICKET', 'This QR code is not a valid ticket');
  }
}
