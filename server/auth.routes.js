const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const DB = require("./db");

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const COOKIE_NAME = "ugynokseg_token";

function signToken(user) {
  return jwt.sign(
    { uid: user.id, email: user.email, name: user.display_name },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

router.post("/register", async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    const em = String(email || "").trim().toLowerCase();
    const pw = String(password || "");
    const nm = String(name || "").trim();

    if (!em || !em.includes("@") || !nm || !pw) return res.status(400).json({ error: "Hiányzó adat." });
    if (pw.length < 6) return res.status(400).json({ error: "A jelszó min. 6 karakter." });

    if (DB.getUserByEmail(em)) return res.status(409).json({ error: "Email már létezik." });

    const hash = await bcrypt.hash(pw, 10);
    const user = DB.createUser({ email: em, display_name: nm, password_hash: hash });

    const token = signToken(user);
    res.cookie(COOKIE_NAME, token, cookieOpts());
    return res.json({ ok: true, user: { uid: user.id, email: user.email, name: user.display_name } });
  } catch (e) {
    return res.status(500).json({ error: "Szerver hiba." });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const em = String(email || "").trim().toLowerCase();
    const pw = String(password || "");

    if (!em || !pw) return res.status(400).json({ error: "Hiányzó adat." });

    const user = DB.getUserByEmail(em);
    if (!user) return res.status(401).json({ error: "Hibás adatok." });

    const ok = await bcrypt.compare(pw, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Hibás adatok." });

    const token = signToken(user);
    res.cookie(COOKIE_NAME, token, cookieOpts());
    return res.json({ ok: true, user: { uid: user.id, email: user.email, name: user.display_name, elo: user.elo, wins: user.wins, losses: user.losses } });
  } catch (e) {
    return res.status(500).json({ error: "Szerver hiba." });
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

router.get("/me", (req, res) => {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.json({ user: null });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return res.json({ user: payload });
  } catch {
    return res.json({ user: null });
  }
});

router.get("/leaderboard", (req, res) => {
  try {
    return res.json(DB.listLeaderboard(100));
  } catch {
    return res.status(500).json({ error: "Szerver hiba." });
  }
});

module.exports = router;