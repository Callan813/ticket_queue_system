import { z } from 'zod';

/**
 * Zod is the single source of truth for input validation. Controllers call
 * `parse()`; a ZodError bubbles up to the error handler and becomes a 400.
 */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data);
}

/**
 * Converts a Zod schema to JSON Schema for the OpenAPI docs only.
 * (Fastify's own validator is disabled in app.ts so inputs aren't validated twice.)
 */
export function toOpenApi(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  return jsonSchema;
}

export const uuidParam = z.object({ id: z.string().uuid() });
