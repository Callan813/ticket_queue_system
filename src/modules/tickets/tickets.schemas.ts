import { z } from 'zod';

export const verifyTicketBody = z.object({ qrToken: z.string().min(1).max(2000) });
