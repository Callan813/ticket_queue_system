import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { logger } from '../lib/logger';
import { createRedisConnection } from '../lib/redis';
import { SEAT_UPDATES_CHANNEL, type SeatUpdateMessage } from './seatUpdates';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const roomFor = (eventId: string) => `event:${eventId}`;

/**
 * WebSocket layer for live seat maps.
 *
 *   browser --join-event(eventId)--> socket room "event:<id>"
 *   any service --PUBLISH seat-updates--> Redis --> every API instance --> room --> browsers
 *
 * Going through Redis pub/sub (instead of emitting directly) means a change
 * made by any instance, or by the background worker, reaches every browser.
 */
export async function attachSocketServer(app: FastifyInstance) {
  const io = new Server(app.server, { cors: { origin: '*' } });
  const subscriber = createRedisConnection();

  io.on('connection', (socket) => {
    socket.on('join-event', (eventId: unknown) => {
      if (typeof eventId === 'string' && UUID.test(eventId)) void socket.join(roomFor(eventId));
    });
    socket.on('leave-event', (eventId: unknown) => {
      if (typeof eventId === 'string') void socket.leave(roomFor(eventId));
    });
  });

  subscriber.on('message', (_channel, raw) => {
    try {
      const message = JSON.parse(raw) as SeatUpdateMessage;
      io.to(roomFor(message.eventId)).emit('seat-update', message);
    } catch (err) {
      logger.warn({ err }, 'Ignoring malformed seat update');
    }
  });
  await subscriber.subscribe(SEAT_UPDATES_CHANNEL);

  // Drop WebSocket connections before Fastify closes the HTTP server,
  // otherwise open sockets would keep the shutdown waiting.
  app.addHook('preClose', async () => {
    io.disconnectSockets(true);
    io.engine.close();
  });
  app.addHook('onClose', async () => {
    await subscriber.quit();
  });

  return io;
}
