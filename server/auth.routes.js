const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("./db");

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const COOKIE_NAME = "ugynokseg_token";

// 30 nap
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function signToken(user) {
  return jwt.sign(
    { uid: user.id, email: user.email, name: user.display_name },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE_MS,
    path: "/",
  };
}

// REGISZTRÁCIÓ
router.post("/register", async (req, res) => {
  try {
    const { email, password, name } = req.body || {};

    if (!email || !password || !name) {
      return res.status(400).json({ error: "Hiányzó adat." });
    }

    if (String(password).length < 6) {
      return res.status(400).json({ error: "A jelszó min. 6 karakter." });
    }

    const existing = db.prepare("SELECT id FROM users WHERE email=?").get(email);
    if (existing) {
      return res.status(409).json({ error: "Email már létezik." });
    }

    const hash = await bcrypt.hash(password, 10);
    const created_at = new Date().toISOString();

    const info = db.prepare(
      "INSERT INTO users (email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)"
    ).run(email, name, hash, created_at);

    const token = signToken({
      id: info.lastInsertRowid,
      email,
      display_name: name,
    });

    res.cookie(COOKIE_NAME, token, cookieOptions());
    return res.json({ ok: true });
  } catch (err) {
    console.error("register error:", err);
    return res.status(500).json({ error: "Szerver hiba." });
  }
});

// LOGIN
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    const row = db.prepare("SELECT * FROM users WHERE email=?").get(email);
    if (!row) return res.status(401).json({ error: "Hibás adatok." });

    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: "Hibás adatok." });

    const token = signToken(row);
    res.cookie(COOKIE_NAME, token, cookieOptions());
    return res.json({ ok: true });
  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ error: "Szerver hiba." });
  }
});

// LOGOUT (hasznos UX-hez)
router.post("/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return res.json({ ok: true });
});

// ME (ki van belépve)
router.get("/me", (req, res) => {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.json({ user: null });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return res.json({ user: payload });
  } catch (e) {
    return res.json({ user: null });
  }
});

module.exports = router;