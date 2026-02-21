const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "data.sqlite"));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

module.exports = db;

// ✅ ELO / stats (MVP): add columns if missing
try { db.prepare("ALTER TABLE users ADD COLUMN elo INTEGER NOT NULL DEFAULT 1000").run(); } catch(e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN wins INTEGER NOT NULL DEFAULT 0").run(); } catch(e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN losses INTEGER NOT NULL DEFAULT 0").run(); } catch(e) {}
