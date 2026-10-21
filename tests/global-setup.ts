import { execSync } from 'node:child_process';
import net from 'node:net';

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 1500 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/** Runs once before all test files: checks dependencies are up and migrates the test database. */
export default async function globalSetup() {
  require('./setup-env');
  const db = new URL(process.env.DATABASE_URL!);
  const redis = new URL(process.env.REDIS_URL!);

  const [dbUp, redisUp] = await Promise.all([
    canConnect(db.hostname, Number(db.port || 5432)),
    canConnect(redis.hostname, Number(redis.port || 6379)),
  ]);
  if (!dbUp || !redisUp) {
    throw new Error(
      `Tests need Postgres (${dbUp ? 'up' : 'DOWN'}) and Redis (${redisUp ? 'up' : 'DOWN'}).\n` +
        'Start them with:  npm run test:deps   (docker compose up -d postgres redis)',
    );
  }

  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: process.env });
}
