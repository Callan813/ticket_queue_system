import type { FastifyInstance } from 'fastify';
import request from 'supertest';
import bcrypt from 'bcrypt';
import type { Role } from '@prisma/client';
import { buildApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { redis } from '../src/lib/redis';
import { signAccessToken } from '../src/lib/jwt';

export { prisma, redis };

export async function createTestApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

/** Wipes every table and the test Redis DB so each test starts clean. */
export async function resetState() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Ticket", "BookingSeat", "Booking", "Seat", "Event", "User" RESTART IDENTITY CASCADE',
  );
  await redis.flushdb();
}

let userCounter = 0;
const FAST_HASH = bcrypt.hashSync('password123', 4);

/** Inserts a user directly and returns it with a ready-to-use Authorization header. */
export async function createUser(role: Role = 'ATTENDEE', name?: string) {
  userCounter += 1;
  const user = await prisma.user.create({
    data: {
      name: name ?? `${role.toLowerCase()} ${userCounter}`,
      email: `${role.toLowerCase()}${userCounter}-${Date.now()}@test.dev`,
      passwordHash: FAST_HASH,
      role,
    },
  });
  return { ...user, auth: { Authorization: `Bearer ${signAccessToken(user)}` } };
}

/** A published event (starting tomorrow) with `rows` x `perRow` seats priced at 500.00. */
export async function createPublishedEvent(organiserId: string, rows = 2, perRow = 5) {
  return prisma.event.create({
    data: {
      organiserId,
      title: 'Test Fest',
      venue: 'Main Hall',
      startsAt: new Date(Date.now() + 24 * 3600 * 1000),
      status: 'PUBLISHED',
      seats: {
        create: Array.from({ length: rows * perRow }, (_, i) => ({
          row: String.fromCharCode(65 + Math.floor(i / perRow)),
          number: (i % perRow) + 1,
          tier: 'STANDARD',
          price: 50000,
        })),
      },
    },
    include: { seats: { orderBy: [{ row: 'asc' }, { number: 'asc' }] } },
  });
}

export async function closeConnections(app?: FastifyInstance) {
  await app?.close();
  await prisma.$disconnect();
  redis.disconnect();
}

export const api = (app: FastifyInstance) => request(app.server);
