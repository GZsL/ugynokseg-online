const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("./db");

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const COOKIE_NAME = "ugynokseg_token";
const IS_PROD = process.env.NODE_ENV === "production";

const cookieOpts = {
  httpOnly: true,
  sameSite: "lax",
  secure: IS_PROD,
  maxAge: 1000 * 60 * 60 * 24 * 30 // 30 nap
};

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function signToken(user) {
  return jwt.sign(
    { uid: user.id, email: user.email, name: user.display_name },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

// REGISZTRÁCIÓ
router.post("/register", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    const name = String(req.body.name || "").trim();

    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Hibás email." });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: "A jelszó min. 6 karakter." });
    }
    if (!name || name.length < 2) {
      return res.status(400).json({ error: "Add meg a neved." });
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

    const user = { id: info.lastInsertRowid, email, display_name: name };
    const token = signToken(user);

    res.cookie(COOKIE_NAME, token, cookieOpts);
    res.json({ ok: true, user: { id: user.id, email: user.email, name: user.display_name } });
  } catch (err) {
    console.error("REGISTER error:", err);
    res.status(500).json({ error: "Szerver hiba." });
  }
});

// LOGIN
router.post("/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Hiányzó adat." });
    }

    const row = db.prepare("SELECT * FROM users WHERE email=?").get(email);
    if (!row) {
      return res.status(401).json({ error: "Hibás email vagy jelszó." });
    }

    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Hibás email vagy jelszó." });
    }

    const token = signToken(row);
    res.cookie(COOKIE_NAME, token, cookieOpts);

    res.json({
      ok: true,
      user: { id: row.id, email: row.email, name: row.display_name }
    });
  } catch (err) {
    console.error("LOGIN error:", err);
    res.status(500).json({ error: "Szerver hiba." });
  }
});

// LOGOUT
router.post("/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: cookieOpts.sameSite,
    secure: cookieOpts.secure
  });
  res.json({ ok: true });
});

// ME (ki van belépve)
router.get("/me", (req, res) => {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.json({ user: null });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    res.json({ user: payload });
  } catch (err) {
    // ha lejárt/hibás token, töröljük a cookie-t is, hogy ne ragadjon be
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      sameSite: cookieOpts.sameSite,
      secure: cookieOpts.secure
    });
    res.json({ user: null });
  }
});

module.exports = router;