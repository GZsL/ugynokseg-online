const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "users.json");

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: [] }, null, 2), "utf8");
}

function read() {
  ensure();
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return { users: [] }; }
}

function write(db) {
  ensure();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

function uid() {
  return "u_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}

function getUserByEmail(email) {
  const em = String(email || "").trim().toLowerCase();
  const db = read();
  return db.users.find(u => u.email === em) || null;
}

function createUser({ email, display_name, password_hash }) {
  const db = read();
  const user = {
    id: uid(),
    email: String(email || "").trim().toLowerCase(),
    display_name: String(display_name || "").trim(),
    password_hash: String(password_hash || ""),
    created_at: new Date().toISOString(),
    elo: 1000,
    wins: 0,
    losses: 0
  };
  db.users.push(user);
  write(db);
  return user;
}

function listLeaderboard(limit = 100) {
  const db = read();
  return [...db.users]
    .sort((a,b) => (b.elo||0)-(a.elo||0) || (b.wins||0)-(a.wins||0))
    .slice(0, limit)
    .map(u => ({ name: u.display_name, elo: u.elo, wins: u.wins, losses: u.losses }));
}

module.exports = { getUserByEmail, createUser, listLeaderboard };