// server/room-store.js
// Room persistence: Redis first, in-memory fallback

const redis = require("./redis");

const KEY_PREFIX = process.env.REDIS_ROOM_PREFIX || "room:";
const DEFAULT_TTL_MS = Number(process.env.ROOM_TTL_MS || 1000 * 60 * 60 * 6); // 6 hours

const mem = new Map();

function key(code) {
  return `${KEY_PREFIX}${code}`;
}

async function getRoom(code) {
  if (!code) return null;
  if (!redis) return mem.get(code) || null;

  const raw = await redis.get(key(code));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function setRoom(code, room, ttlMs = DEFAULT_TTL_MS) {
  if (!code) return;
  if (!redis) {
    mem.set(code, room);
    return;
  }

  const payload = JSON.stringify(room);
  await redis.set(key(code), payload, "PX", ttlMs);
}

async function deleteRoom(code) {
  if (!code) return;
  if (!redis) {
    mem.delete(code);
    return;
  }
  await redis.del(key(code));
}

async function listRooms(limit = 200) {
  if (!redis) return Array.from(mem.keys()).slice(0, limit);

  const pattern = `${KEY_PREFIX}*`;
  let cursor = "0";
  const codes = [];

  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
    cursor = nextCursor;
    for (const k of keys || []) {
      if (codes.length >= limit) break;
      const code = k.startsWith(KEY_PREFIX) ? k.slice(KEY_PREFIX.length) : k;
      codes.push(code);
    }
  } while (cursor !== "0" && codes.length < limit);

  return codes;
}

module.exports = { getRoom, setRoom, deleteRoom, listRooms };
