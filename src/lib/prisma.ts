import { Prisma, PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

/** True when `err` is a unique-constraint violation (Postgres 23505 / Prisma P2002). */
export function isUniqueViolation(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** Which columns/index a unique violation was about, as a single lowercase string. */
export function uniqueViolationTarget(err: Prisma.PrismaClientKnownRequestError): string {
  const target = err.meta?.target;
  return (Array.isArray(target) ? target.join(',') : String(target ?? '')).toLowerCase();
}
