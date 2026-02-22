const express = require("express");
const router = express.Router();

const db = require("./db");
const prisma = db?.prisma || db;

async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS match_results (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      display_name TEXT,
      outcome TEXT NOT NULL,
      points INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS match_results_user_id_idx ON match_results(user_id);
  `);
}

/**
 * GET /api/leaderboard?limit=50
 * Public read (shows only registered users because results can only be written by auth users).
 */
router.get("/", async (req, res) => {
  try {
    await ensureTable();

    const limitRaw = Number(req.query?.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.trunc(limitRaw))) : 50;

    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        user_id AS "userId",
        COALESCE(NULLIF(display_name, ''), user_id) AS "displayName",
        SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END)::int AS wins,
        SUM(CASE WHEN outcome = 'loss' THEN 1 ELSE 0 END)::int AS losses,
        SUM(CASE WHEN outcome = 'draw' THEN 1 ELSE 0 END)::int AS draws,
        COUNT(*)::int AS games,
        COALESCE(SUM(points), 0)::int AS points
      FROM match_results
      GROUP BY user_id, COALESCE(NULLIF(display_name, ''), user_id)
      ORDER BY wins DESC, points DESC, games ASC, "displayName" ASC
      LIMIT $1;
    `, limit);

    return res.json({ ok: true, items: rows });
  } catch (err) {
    console.error("leaderboard error:", err);
    return res.status(500).json({ ok: false, error: "Failed to load leaderboard." });
  }
});

module.exports = router;
