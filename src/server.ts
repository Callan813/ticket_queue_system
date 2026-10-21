import { buildApp } from './app';
import { config } from './config';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { jobs } from './jobs/queue';
import { startWorker } from './jobs/worker';
import { seedDemoData } from './scripts/seed';

async function main() {
  if (config.SEED_ON_START) await seedDemoData();

  const app = await buildApp();
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  const worker = config.RUN_WORKER ? startWorker() : null;

  // Graceful shutdown: stop accepting connections, let in-flight requests
  // finish, then close the DB and Redis connections.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    const forceExit = setTimeout(() => {
      logger.error('Shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000).unref();
    try {
      await app.close();
      await worker?.close();
      await jobs.close();
      await prisma.$disconnect();
      redis.disconnect();
      clearTimeout(forceExit);
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
