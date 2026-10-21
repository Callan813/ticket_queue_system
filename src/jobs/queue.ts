import { Queue } from 'bullmq';
import { logger } from '../lib/logger';
import type Redis from 'ioredis';
import { createRedisConnection } from '../lib/redis';

export const QUEUE_NAME = 'booking-jobs';

export const JOB = {
  /** Fires when a seat hold's TTL is up: clean up and tell watchers the seats are free. */
  HOLD_EXPIRY: 'hold-expiry',
  /** Fires when a PENDING booking hasn't been paid in time: cancel it and free the seats. */
  PAYMENT_TIMEOUT: 'payment-timeout',
} as const;

export interface HoldExpiryData {
  holdId: string;
  eventId: string;
  seatIds: string[];
}

export interface PaymentTimeoutData {
  bookingId: string;
}

let queue: Queue | undefined;
let connection: Redis | undefined;

/** Created lazily so importing this module doesn't open a Redis connection. */
function getQueue(): Queue {
  if (queue) return queue;
  connection = createRedisConnection({ forBullMQ: true });
  queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  });
  return queue;
}

// Deterministic job ids let us cancel a job later without storing its id anywhere.
const holdJobId = (holdId: string) => `hold-${holdId}`;
const paymentJobId = (bookingId: string) => `payment-${bookingId}`;

async function removeJob(jobId: string) {
  try {
    await getQueue().remove(jobId);
  } catch (err) {
    // The job may already be running; it is written to be harmless in that case.
    logger.debug({ err, jobId }, 'Could not remove job');
  }
}

export const jobs = {
  async scheduleHoldExpiry(data: HoldExpiryData, delayMs: number) {
    await getQueue().add(JOB.HOLD_EXPIRY, data, { jobId: holdJobId(data.holdId), delay: delayMs });
  },

  cancelHoldExpiry(holdId: string) {
    return removeJob(holdJobId(holdId));
  },

  async schedulePaymentTimeout(data: PaymentTimeoutData, delayMs: number) {
    await getQueue().add(JOB.PAYMENT_TIMEOUT, data, { jobId: paymentJobId(data.bookingId), delay: delayMs });
  },

  cancelPaymentTimeout(bookingId: string) {
    return removeJob(paymentJobId(bookingId));
  },

  async close() {
    // BullMQ does not close a connection it was handed, so quit it ourselves.
    await queue?.close();
    await connection?.quit();
    queue = undefined;
    connection = undefined;
  },
};
