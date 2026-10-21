import type { Result } from 'ioredis';
import { redis } from '../../lib/redis';

/**
 * Redis is the "fast lock" layer for seats. Every held seat is one key:
 *
 *   seat:{eventId}:{seatId}  ->  holdId      (expires after HOLD_TTL_SECONDS)
 *   hold:{holdId}            ->  HoldRecord  (same TTL, describes the whole hold)
 *
 * The value is the holdId (not just the userId) so a booking can prove that the
 * seat is held *by this specific hold*, and a release can never delete a newer
 * hold that someone else placed after ours expired.
 */
export interface HoldRecord {
  holdId: string;
  userId: string;
  eventId: string;
  seatIds: string[];
  expiresAt: string;
}

const seatKey = (eventId: string, seatId: string) => `seat:${eventId}:${seatId}`;
const holdKey = (holdId: string) => `hold:${holdId}`;
const seatIdFromKey = (key: string) => key.slice(key.lastIndexOf(':') + 1);

/**
 * All-or-nothing hold, run atomically inside Redis (Lua scripts execute without
 * interleaving any other command). If ANY seat is already held we set nothing
 * and return the taken keys, so there is never a half-acquired hold to undo.
 *
 * KEYS[1..n-1] = seat keys, KEYS[n] = hold key
 * ARGV[1] = holdId, ARGV[2] = ttl seconds, ARGV[3] = hold record JSON
 */
const ACQUIRE_HOLD_LUA = `
local taken = {}
for i = 1, #KEYS - 1 do
  if redis.call('EXISTS', KEYS[i]) == 1 then
    table.insert(taken, KEYS[i])
  end
end
if #taken > 0 then
  return taken
end
for i = 1, #KEYS - 1 do
  redis.call('SET', KEYS[i], ARGV[1], 'NX', 'EX', ARGV[2])
end
redis.call('SET', KEYS[#KEYS], ARGV[3], 'EX', ARGV[2])
return taken
`;

/**
 * Compare-and-delete: only removes seat keys that still point at THIS hold.
 * Returns the keys that were actually released.
 *
 * KEYS[1..n-1] = seat keys, KEYS[n] = hold key, ARGV[1] = holdId
 */
const RELEASE_HOLD_LUA = `
local released = {}
for i = 1, #KEYS - 1 do
  if redis.call('GET', KEYS[i]) == ARGV[1] then
    redis.call('DEL', KEYS[i])
    table.insert(released, KEYS[i])
  end
end
redis.call('DEL', KEYS[#KEYS])
return released
`;

redis.defineCommand('acquireHold', { lua: ACQUIRE_HOLD_LUA });
redis.defineCommand('releaseHold', { lua: RELEASE_HOLD_LUA });

declare module 'ioredis' {
  interface RedisCommander<Context> {
    acquireHold(numKeys: number, ...keysAndArgs: (string | number)[]): Result<string[], Context>;
    releaseHold(numKeys: number, ...keysAndArgs: (string | number)[]): Result<string[], Context>;
  }
}

function keysFor(hold: Pick<HoldRecord, 'holdId' | 'eventId' | 'seatIds'>) {
  return [...hold.seatIds.map((id) => seatKey(hold.eventId, id)), holdKey(hold.holdId)];
}

export const holdStore = {
  /** Tries to hold every seat. Returns the ids of seats that were already taken (empty = success). */
  async acquire(hold: HoldRecord, ttlSeconds: number): Promise<string[]> {
    const keys = keysFor(hold);
    const taken = await redis.acquireHold(keys.length, ...keys, hold.holdId, ttlSeconds, JSON.stringify(hold));
    return taken.map(seatIdFromKey);
  },

  /** Releases the seats still owned by this hold. Returns the seat ids that were released. */
  async release(hold: Pick<HoldRecord, 'holdId' | 'eventId' | 'seatIds'>): Promise<string[]> {
    const keys = keysFor(hold);
    const released = await redis.releaseHold(keys.length, ...keys, hold.holdId);
    return released.map(seatIdFromKey);
  },

  async get(holdId: string): Promise<HoldRecord | null> {
    const raw = await redis.get(holdKey(holdId));
    return raw ? (JSON.parse(raw) as HoldRecord) : null;
  },

  /** True only if every seat key still exists and points at this hold. */
  async isFullyHeld(hold: HoldRecord): Promise<boolean> {
    const owners = await redis.mget(hold.seatIds.map((id) => seatKey(hold.eventId, id)));
    return owners.every((owner) => owner === hold.holdId);
  },

  /** Which of these seats currently have a live hold on them. */
  async findHeldSeatIds(eventId: string, seatIds: string[]): Promise<Set<string>> {
    if (seatIds.length === 0) return new Set();
    const owners = await redis.mget(seatIds.map((id) => seatKey(eventId, id)));
    return new Set(seatIds.filter((_, i) => owners[i] !== null));
  },
};
