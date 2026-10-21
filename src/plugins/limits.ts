import { config } from '../config';
import { rateLimit } from './rateLimit';

/** Per IP: slows down password guessing and account spam. */
export const authRateLimit = rateLimit({
  name: 'auth',
  max: config.RATE_LIMIT_AUTH_MAX,
  windowSeconds: config.RATE_LIMIT_AUTH_WINDOW_SECONDS,
  keyBy: 'ip',
});

/** Per user: stops one account from hoarding seats by spamming holds/bookings. */
export const bookingRateLimit = rateLimit({
  name: 'booking',
  max: config.RATE_LIMIT_BOOKING_MAX,
  windowSeconds: config.RATE_LIMIT_BOOKING_WINDOW_SECONDS,
  keyBy: 'user',
});
