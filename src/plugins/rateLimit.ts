import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors';
import { redis } from '../lib/redis';

interface RateLimitOptions {
  /** Namespaces the counter, e.g. "auth" or "booking". */
  name: string;
  max: number;
  windowSeconds: number;
  /** "user" needs to run after authentication; falls back to IP if there is no user. */
  keyBy: 'ip' | 'user';
}

/**
 * Fixed-window rate limiter backed by Redis, so the limit holds across every
 * API instance (an in-memory counter would reset per instance and per restart).
 *
 *   key = rl:<name>:<who>:<window number>     INCR it; set a TTL on first use.
 *
 * Trade-off: a client can burst up to 2x `max` across a window boundary. A
 * sliding window fixes that at the cost of more Redis work; fixed is fine here.
 */
export function rateLimit(options: RateLimitOptions) {
  return async function limit(request: FastifyRequest, reply: FastifyReply) {
    const who = options.keyBy === 'user' && request.user ? `user:${request.user.id}` : `ip:${request.ip}`;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const windowNumber = Math.floor(nowSeconds / options.windowSeconds);
    const key = `rl:${options.name}:${who}:${windowNumber}`;

    const results = await redis.multi().incr(key).expire(key, options.windowSeconds).exec();
    const count = Number(results?.[0]?.[1] ?? 0);
    const retryAfter = (windowNumber + 1) * options.windowSeconds - nowSeconds;

    reply.header('X-RateLimit-Limit', options.max);
    reply.header('X-RateLimit-Remaining', Math.max(0, options.max - count));

    if (count > options.max) {
      reply.header('Retry-After', retryAfter);
      throw new AppError(429, 'RATE_LIMITED', 'Too many requests, please slow down', {
        retryAfterSeconds: retryAfter,
      });
    }
  };
}
