const Redis = require("ioredis");

if (!process.env.REDIS_URL) {
  throw new Error("REDIS_URL not set");
}

const redis = new Redis(process.env.REDIS_URL);

redis.on("connect", () => {
  console.log("Redis connected");
});

redis.on("error", (err) => {
  console.error("Redis error:", err);
});

module.exports = redis;