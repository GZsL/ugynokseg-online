const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const db = require("./db");
const prisma = db?.prisma || db;

const { sendMail } = require("./mailer");

const APP_URL = process.env.APP_URL || "";
const JWT_SECRET = process.env.JWT_SECRET || "";

const COOKIE_NAME = "auth";
const cookieOpts = {
  httpOnly: true,
  sameSite: "lax",
  secure: true,
  path: "/",
  maxAge: 1000 * 60 * 60 * 24 * 30
};

function pickString(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function normalizeEmail(raw) {
  const email = String(raw || "").trim().toLowerCase();
  if (!email) return { ok: false, email: "", error: "Hiányzó e-mail cím." };
  if (!email.includes("@") || email.length < 5) return { ok: false, email, error: "Hibás e-mail cím." };
  return { ok: true, email };
}

function mustHaveSecret(res) {
  if (!JWT_SECRET) {
    res.status(500).json({ error: "Server config error: JWT_SECRET missing" });
    return false;
  }
  if (!APP_URL) {
    // Not fatal for login, but verify/reset links need it.
    console.warn("APP_URL is missing (email links may be wrong).");
  }
  return true;
}

function signAuth(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
}

function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

/**
 * POST /api/auth/register
 * body: { name, email, password }
 */
router.post("/register", async (req, res) => {
  try {
    if (!mustHaveSecret(res)) return;

    const name = pickString(req.body, ["name", "username", "displayName"]) || "Játékos";
    const emailRaw = pickString(req.body, ["email", "emailAddress", "mail"]);
    const password = pickString(req.body, ["password", "pass", "pwd"]);

    const e = normalizeEmail(emailRaw);
    if (!e.ok) return res.status(400).json({ error: e.error });

    if (!password || password.length < 6) {
      return res.status(400).json({ error: "A jelszónak legalább 6 karakternek kell lennie." });
    }

    const existing = await prisma.user.findUnique({ where: { email: e.email } });
    if (existing) return res.status(409).json({ error: "Ezzel az e-mail címmel már van fiók." });

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: { email: e.email, name, passwordHash, emailVerified: false }
    });

    // Create verification token row
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = sha256Hex(rawToken);
    await prisma.emailVerificationToken.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    const verifyUrl = `${APP_URL.replace(/\/$/, "")}/verify.html?token=${encodeURIComponent(rawToken)}`;

    let mailOk = false;
    try {
      await sendMail({
        to: user.email,
        subject: "Ügynökség — Email megerősítés",
        html: `<p>Szia <b>${escapeHtml(user.name || "Játékos")}</b>!</p>
               <p>Email megerősítéshez kattints:</p>
               <p><a href="${verifyUrl}">${verifyUrl}</a></p>
               <p>Ha nem te voltál, hagyd figyelmen kívül.</p>`
      });
      mailOk = true;
    } catch (err) {
      console.error("verify email send failed:", err?.message || err);
      // Registration should still succeed even if mail fails.
    }

    // Auto-login cookie (even before verify)
    res.cookie(COOKIE_NAME, signAuth(user), cookieOpts);

    return res.json({ ok: true, mailOk, needsVerify: true });
  } catch (err) {
    console.error("register error:", err);
    return res.status(500).json({ error: "Szerver hiba (register)." });
  }
});

/**
 * GET /api/auth/verify?token=...
 */
router.get("/verify", async (req, res) => {
  try {
    if (!mustHaveSecret(res)) return;

    const token = pickString(req.query, ["token"]);
    if (!token) return res.status(400).send("Missing token.");

    const tokenHash = sha256Hex(token);
    const row = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } });
    if (!row) return res.status(400).send("Invalid token.");
    if (row.expiresAt.getTime() < Date.now()) return res.status(400).send("Token expired.");

    await prisma.user.update({ where: { id: row.userId }, data: { emailVerified: true } });
    await prisma.emailVerificationToken.delete({ where: { tokenHash } });

    const back = `${APP_URL.replace(/\/$/, "")}/intro.html?verified=1`;
    return res.redirect(back);
  } catch (err) {
    console.error("verify error:", err);
    return res.status(500).send("Server error.");
  }
});

/**
 * POST /api/auth/login
 * body: { email, password }
 */
router.post("/login", async (req, res) => {
  try {
    if (!mustHaveSecret(res)) return;

    const emailRaw = pickString(req.body, ["email", "emailAddress", "mail"]);
    const password = pickString(req.body, ["password", "pass", "pwd"]);

    const e = normalizeEmail(emailRaw);
    if (!e.ok) return res.status(400).json({ error: e.error });

    const user = await prisma.user.findUnique({ where: { email: e.email } });
    if (!user) return res.status(401).json({ error: "Hibás e-mail vagy jelszó." });

    const ok = await bcrypt.compare(password || "", user.passwordHash || "");
    if (!ok) return res.status(401).json({ error: "Hibás e-mail vagy jelszó." });

    res.cookie(COOKIE_NAME, signAuth(user), cookieOpts);
    return res.json({ ok: true });
  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ error: "Szerver hiba (login)." });
  }
});

/**
 * POST /api/auth/logout
 */
router.post("/logout", async (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

/**
 * GET /api/auth/me
 */
router.get("/me", async (req, res) => {
  try {
    if (!mustHaveSecret(res)) return;

    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return res.status(401).json({ ok: false });

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ ok: false });
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return res.status(401).json({ ok: false });

    return res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name, emailVerified: !!user.emailVerified } });
  } catch (err) {
    console.error("me error:", err);
    return res.status(500).json({ ok: false });
  }
});

/**
 * POST /api/auth/forgot
 * body: { email }
 */
router.post("/forgot", async (req, res) => {
  try {
    if (!mustHaveSecret(res)) return;

    const emailRaw = pickString(req.body, ["email", "emailAddress", "mail"]);
    const e = normalizeEmail(emailRaw);

    // Don't leak account existence
    if (!e.ok) return res.json({ ok: true });

    const user = await prisma.user.findUnique({ where: { email: e.email } }).catch(() => null);
    if (!user) return res.json({ ok: true });

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = sha256Hex(rawToken);

    await prisma.passwordResetToken.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      }
    });

    const resetUrl = `${APP_URL.replace(/\/$/, "")}/reset.html?token=${encodeURIComponent(rawToken)}`;

    try {
      await sendMail({
        to: user.email,
        subject: "Ügynökség — Jelszó visszaállítás",
        html: `<p>Jelszó visszaállítás:</p><p><a href="${resetUrl}">${resetUrl}</a></p>`
      });
    } catch (err) {
      console.error("reset email send failed:", err?.message || err);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("forgot error:", err);
    return res.status(500).json({ ok: false });
  }
});

/**
 * POST /api/auth/reset
 * body: { token, password }
 */
router.post("/reset", async (req, res) => {
  try {
    if (!mustHaveSecret(res)) return;

    const token = pickString(req.body, ["token"]);
    const password = pickString(req.body, ["password", "pass", "pwd"]);

    if (!token) return res.status(400).json({ error: "Missing token." });
    if (!password || password.length < 6) return res.status(400).json({ error: "A jelszónak legalább 6 karakternek kell lennie." });

    const tokenHash = sha256Hex(token);
    const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!row) return res.status(400).json({ error: "Invalid token." });
    if (row.expiresAt.getTime() < Date.now()) return res.status(400).json({ error: "Token lejárt." });

    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.update({ where: { id: row.userId }, data: { passwordHash } });
    await prisma.passwordResetToken.delete({ where: { tokenHash } });

    return res.json({ ok: true });
  } catch (err) {
    console.error("reset error:", err);
    return res.status(500).json({ ok: false });
  }
});

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

module.exports = router;
