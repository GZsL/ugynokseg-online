// server/db.js
// Postgres connection pool (Render friendly)

const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  // Keep server running even without DB (MVP)
  console.warn("DATABASE_URL not set - DB disabled");

  module.exports = {
    async query() {
      throw new Error("DB disabled (missing DATABASE_URL)");
    },
  };
} else {
  // Render Postgres usually needs SSL; local dev typically doesn't
  const useSSL = String(process.env.PGSSLMODE || "").toLowerCase() === "require" ||
    String(process.env.PG_SSL || "true").toLowerCase() === "true";

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: useSSL ? { rejectUnauthorized: false } : false,
  });

  module.exports = pool;
}
