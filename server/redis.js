// server/redis.js
const Redis = require("ioredis");

const url = process.env.REDIS_URL;
if (!url) {
  console.warn("REDIS_URL not set – Redis disabled");
  module.exports = null;
} else {
  const redis = new Redis(url, {
    // Render internal KV: nincs auth by default; ha van, az URL-ben lesz.
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  redis.on("connect", () => console.log("Redis connect OK"));
  redis.on("ready", () => console.log("Redis ready OK"));
  redis.on("error", (e) => console.error("Redis error:", e.message));

  module.exports = redis;
}