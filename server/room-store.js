// server/room-store.js
const redis = require("./redis");

const KEY_PREFIX = process.env.REDIS_ROOM_PREFIX || "room:";
const DEFAULT_TTL_MS = Number(process.env.ROOM_TTL_MS || 1000 * 60 * 60 * 6); // 6 óra

// Fallback in-memory store, ha nincs Redis / Redis hiba van
const mem = new Map();

function key(code) {
  return `${KEY_PREFIX}${code}`;
}

function safeJsonParse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

async function getRoom(code) {
  if (!code) return null;

  // 1) próbáljuk Redisből
  if (redis) {
    try {
      const raw = await redis.get(key(code));
      if (raw) {
        const obj = safeJsonParse(raw);
        if (obj) return obj;
      }
      // ha nincs key vagy sérült: esünk mem-re
    } catch (e) {
      console.error("Redis GET error, fallback to mem:", e?.message || e);
    }
  }

  // 2) fallback mem
  return mem.get(code) || null;
}

async function setRoom(code, room, ttlMs = DEFAULT_TTL_MS) {
  if (!code) return;

  // mindig tartsuk mem-ben is (Redis hiba esetén azonnal működjön)
  mem.set(code, room);

  if (!redis) return;

  try {
    const payload = JSON.stringify(room);
    const px = Number(ttlMs || DEFAULT_TTL_MS) || DEFAULT_TTL_MS;
    await redis.set(key(code), payload, "PX", px);
  } catch (e) {
    console.error("Redis SET error, kept in mem:", e?.message || e);
  }
}

async function deleteRoom(code) {
  if (!code) return;

  mem.delete(code);

  if (!redis) return;

  try {
    await redis.del(key(code));
  } catch (e) {
    console.error("Redis DEL error:", e?.message || e);
  }
}

async function listRooms(limit = 200) {
  const out = new Set();

  // mem
  for (const k of mem.keys()) {
    out.add(k);
    if (out.size >= limit) return Array.from(out);
  }

  if (!redis) return Array.from(out);

  // Redis SCAN
  const pattern = `${KEY_PREFIX}*`;
  let cursor = "0";

  try {
    do {
      const res = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
      cursor = res[0];
      const keys = res[1] || [];

      for (const k of keys) {
        if (out.size >= limit) break;
        const code = k.startsWith(KEY_PREFIX) ? k.slice(KEY_PREFIX.length) : k;
        out.add(code);
      }
    } while (cursor !== "0" && out.size < limit);
  } catch (e) {
    console.error("Redis SCAN error:", e?.message || e);
  }

  return Array.from(out).slice(0, limit);
}

module.exports = {
  getRoom,
  setRoom,
  deleteRoom,
  listRooms,
};
