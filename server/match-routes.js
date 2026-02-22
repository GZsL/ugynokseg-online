const express = require("express");
const router = express.Router();

/**
 * Match result storage (DB-agnostic):
 * We use raw SQL so this works even if your Prisma schema doesn't yet include match tables.
 *
 * Table: match_results
 *  - id BIGSERIAL PK
 *  - user_id TEXT
 *  - display_name TEXT
 *  - outcome TEXT ('win'|'loss'|'draw')
 *  - points INT
 *  - created_at TIMESTAMPTZ DEFAULT now()
 */

const db = require("./db");
const prisma = db?.prisma || db;

const { requireAuth } = require("./auth-middleware");

async function ensureTable() {
  // Idempotent. Safe to call often.
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
  // Helpful index for leaderboard queries
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS match_results_user_id_idx ON match_results(user_id);
  `);
}

/**
 * POST /api/match/finish
 * Body:
 *  - outcome: 'win' | 'loss' | 'draw'  (required)
 *  - points: number (optional, default 0)
 *
 * Auth required: yes
 */
router.post("/finish", requireAuth, async (req, res) => {
  try {
    await ensureTable();

    const outcome = String(req.body?.outcome || "").toLowerCase();
    const allowed = new Set(["win", "loss", "draw"]);
    if (!allowed.has(outcome)) {
      return res.status(400).json({ error: "Invalid outcome. Use win|loss|draw." });
    }

    const pointsRaw = req.body?.points;
    const points = Number.isFinite(pointsRaw) ? pointsRaw : Number(pointsRaw);
    const safePoints = Number.isFinite(points) ? Math.trunc(points) : 0;

    const user = req.user; // set by requireAuth
    const userId = String(user.id);
    const displayName = String(user.name || user.email || userId);

    await prisma.$executeRawUnsafe(
      `INSERT INTO match_results (user_id, display_name, outcome, points) VALUES ($1, $2, $3, $4)`,
      userId,
      displayName,
      outcome,
      safePoints
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("match/finish error:", err);
    return res.status(500).json({ error: "Failed to save match result." });
  }
});

module.exports = router;
