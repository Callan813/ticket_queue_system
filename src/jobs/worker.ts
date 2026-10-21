import { type Job, Worker } from 'bullmq';
import { logger } from '../lib/logger';
import { createRedisConnection } from '../lib/redis';
import { bookingsService } from '../modules/bookings/bookings.service';
import { holdsService } from '../modules/holds/holds.service';
import { JOB, type HoldExpiryData, type PaymentTimeoutData, QUEUE_NAME } from './queue';

/**
 * Processes delayed jobs. Both handlers are idempotent — safe to run twice, or
 * after the user already acted — because BullMQ guarantees "at least once",
 * not "exactly once".
 */
async function processJob(job: Job) {
  switch (job.name) {
    case JOB.HOLD_EXPIRY: {
      const { holdId, eventId, seatIds } = job.data as HoldExpiryData;
      const freed = await holdsService.expireHold(holdId, eventId, seatIds);
      return { freedSeats: freed.length };
    }
    case JOB.PAYMENT_TIMEOUT: {
      const { bookingId } = job.data as PaymentTimeoutData;
      return { cancelled: await bookingsService.expireUnpaidBooking(bookingId) };
    }
    default:
      throw new Error(`Unknown job type: ${job.name}`);
  }
}

export function startWorker() {
  const connection = createRedisConnection({ forBullMQ: true });
  const worker = new Worker(QUEUE_NAME, processJob, { connection, concurrency: 5 });

  worker.on('completed', (job, result) => logger.info({ jobId: job.id, job: job.name, result }, 'Job completed'));
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, job: job?.name, err }, 'Job failed'));
  // Without an 'error' listener, Node treats connection hiccups as unhandled errors.
  worker.on('error', (err) => logger.error({ err }, 'Worker error'));

  logger.info('Job worker started');
  return {
    async close() {
      await worker.close();
      await connection.quit();
    },
  };
}
