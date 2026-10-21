import type { LoggerOptions } from 'pino';
import pino from 'pino';
import { config } from '../config';

/** Shared pino options so the API (via Fastify) and the job worker log the same way. */
export const loggerOptions: LoggerOptions = {
  level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
  redact: ['req.headers.authorization', 'req.headers["x-razorpay-signature"]'],
  ...(config.NODE_ENV === 'development' && {
    transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
  }),
};

/** Logger for code that runs outside a request (worker, startup, scripts). */
export const logger = pino(loggerOptions);
