import { z } from 'zod';
import { config } from '../../config';

export const createHoldBody = z.object({
  seatIds: z
    .array(z.string().uuid())
    .min(1)
    .max(config.MAX_SEATS_PER_HOLD, `You can hold at most ${config.MAX_SEATS_PER_HOLD} seats at once`)
    .refine((ids) => new Set(ids).size === ids.length, 'Seat ids must be unique'),
});

export const holdIdParam = z.object({ holdId: z.string().uuid() });

export type CreateHoldInput = z.infer<typeof createHoldBody>;
