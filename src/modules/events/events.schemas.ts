import { z } from 'zod';

const futureDate = z.coerce.date().refine((d) => d.getTime() > Date.now(), 'Must be in the future');

export const createEventBody = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(5000).default(''),
  venue: z.string().trim().min(2).max(200),
  startsAt: futureDate,
});

export const updateEventBody = z
  .object({
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(5000),
    venue: z.string().trim().min(2).max(200),
    startsAt: futureDate,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');

export const listEventsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  /** Only events starting on/after this date. */
  from: z.coerce.date().optional(),
  /** Only events starting on/before this date. */
  to: z.coerce.date().optional(),
  venue: z.string().trim().min(1).max(200).optional(),
  /** Case-insensitive match on title or description. */
  search: z.string().trim().min(1).max(200).optional(),
});

/**
 * A seat layout is described row by row, e.g.
 *   { "rows": [{ "row": "A", "seats": 10, "tier": "VIP", "price": 150000 }] }
 * creates seats A1..A10. Prices are in minor units (150000 = ₹1500.00).
 */
export const seatLayoutBody = z.object({
  rows: z
    .array(
      z.object({
        row: z.string().trim().toUpperCase().regex(/^[A-Z]{1,3}$/, 'Row must be 1-3 letters'),
        seats: z.number().int().min(1).max(100),
        startNumber: z.number().int().min(1).default(1),
        tier: z.string().trim().min(1).max(50),
        price: z.number().int().min(0).max(10_000_000),
      }),
    )
    .min(1)
    .max(50),
});

export type CreateEventInput = z.infer<typeof createEventBody>;
export type UpdateEventInput = z.infer<typeof updateEventBody>;
export type ListEventsQuery = z.infer<typeof listEventsQuery>;
export type SeatLayoutInput = z.infer<typeof seatLayoutBody>;
