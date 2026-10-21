import Redis from 'ioredis';
import { config } from '../config';

/** General-purpose connection: seat holds, rate limiting, publishing. */
export const redis = new Redis(config.REDIS_URL);

/**
 * A connection in subscribe mode can't run other commands, and BullMQ needs
 * `maxRetriesPerRequest: null` on its blocking connections — so both get their own.
 */
export function createRedisConnection(options: { forBullMQ?: boolean } = {}) {
  return new Redis(config.REDIS_URL, options.forBullMQ ? { maxRetriesPerRequest: null } : {});
}
