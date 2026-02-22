const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const db = require("./db");
const prisma = db?.prisma || db;

const { sendMail } = require("./mailer");

const APP_URL = process.env.APP_URL || "";
const JWT_SECRET = process.env.JWT_SECRET || "";

// --- helpers ---
function pickString(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function safeEmail(raw) {
  const email = String(raw || "").trim().toLowerCase();
  if (!email) return { ok: false, email: "", error: "Hiányzó e-mail cím." };
  if (!email.includes("@") || email.length < 5) return { ok: false, email, error: "Hibás e-mail cím." };
  return { ok: true, email };
}

function requireEnv(res) {
  if (!JWT_SECRET) {
    res.status(500).json({ error: "Server misconfigured: JWT_SECRET missing." });
    return false;
  }
  return true;
}

function signAuthToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
}

// Cookie settings: works on Render HTTPS
const COOKIE_NAME = "auth";
const cookieOpts = {
  httpOnly: true,
  sameSite: "lax",
  secure: true,
  path: "/",
  maxAge: 1000 * 60 * 60 * 24 * 30
};

// --- routes ---

/**
 * POST /api/auth/register
 * body: { name, email, password } (also accepts username/emailAddress/pass)
 */
router.post("/register", async (req, res) => {
  try {
    if (!requireEnv(res)) return;

    const name = pickString(req.body, ["name", "username", "displayName"]) || "Játékos";
    const emailRaw = pickString(req.body, ["email", "emailAddress", "mail"]);
    const password = pickString(req.body, ["password", "pass", "pwd"]);

    const e = safeEmail(emailRaw);
    if (!e.ok) return res.status(400).json({ error: e.error });

    if (!password || password.length < 6) {
      return res.status(400).json({ error: "A jelszónak legalább 6 karakternek kell lennie." });
    }

    // If your prisma schema uses different field names, adjust here.
    const existing = await prisma.user.findUnique({ where: { email: e.email } }).catch(() => null);
    if (existing) return res.status(409).json({ error: "Ezzel az e-mail címmel már van fiók." });

    const passwordHash = await bcrypt.hash(password, 10);

    const verifyToken = jwt.sign({ email: e.email, purpose: "verify" }, JWT_SECRET, { expiresIn: "24h" });

    const user = await prisma.user.create({
      data: {
        email: e.email,
        name,
        passwordHash,
        emailVerified: false,
        verifyToken
      }
    });

    // Try email, but don't fail registration if SMTP is misconfigured.
    const verifyUrl = `${APP_URL.replace(/\/$/, "")}/api/auth/verify?token=${encodeURIComponent(verifyToken)}`;
    let mailOk = false;
    try {
      await sendMail({
        to: e.email,
        subject: "Ügynökség — Email megerősítés",
        text: `Szia ${name}!\n\nEmail megerősítéshez kattints:\n${verifyUrl}\n\nHa nem te voltál, hagyd figyelmen kívül.`,
        html: `<p>Szia <b>${escapeHtml(name)}</b>!</p>
               <p>Email megerősítéshez kattints:</p>
               <p><a href="${verifyUrl}">${verifyUrl}</a></p>
               <p>Ha nem te voltál, hagyd figyelmen kívül.</p>`
      });
      mailOk = true;
    } catch (err) {
      console.error("verify email send failed:", err?.message || err);
    }

    // Optional: auto-login after register (even before verify). You can change this policy.
    const token = signAuthToken(user);
    res.cookie(COOKIE_NAME, token, cookieOpts);

    return res.json({ ok: true, mailOk, needsVerify: true });
  } catch (err) {
    console.error("register error:", err);
    return res.status(500).json({ error: "Server error (register)." });
  }
});

/**
 * GET /api/auth/verify?token=...
 */
router.get("/verify", async (req, res) => {
  try {
    if (!requireEnv(res)) return;

    const token = typeof req.query?.token === "string" ? req.query.token : "";
    if (!token) return res.status(400).send("Missing token.");

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(400).send("Invalid or expired token.");
    }
    if (!payload?.email || payload?.purpose !== "verify") return res.status(400).send("Invalid token.");

    await prisma.user.update({
      where: { email: String(payload.email).toLowerCase() },
      data: { emailVerified: true, verifyToken: null }
    });

    // Redirect back to app
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
    if (!requireEnv(res)) return;

    const emailRaw = pickString(req.body, ["email", "emailAddress", "mail"]);
    const password = pickString(req.body, ["password", "pass", "pwd"]);

    const e = safeEmail(emailRaw);
    if (!e.ok) return res.status(400).json({ error: e.error });

    const user = await prisma.user.findUnique({ where: { email: e.email } });
    if (!user) return res.status(401).json({ error: "Hibás e-mail vagy jelszó." });

    const ok = await bcrypt.compare(password, user.passwordHash || "");
    if (!ok) return res.status(401).json({ error: "Hibás e-mail vagy jelszó." });

    const token = signAuthToken(user);
    res.cookie(COOKIE_NAME, token, cookieOpts);
    return res.json({ ok: true });
  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ error: "Server error (login)." });
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
    if (!requireEnv(res)) return;

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

    return res.json({
      ok: true,
      user: { id: user.id, email: user.email, name: user.name, emailVerified: !!user.emailVerified }
    });
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
    if (!requireEnv(res)) return;

    const emailRaw = pickString(req.body, ["email", "emailAddress", "mail"]);
    const e = safeEmail(emailRaw);
    if (!e.ok) return res.status(200).json({ ok: true }); // don't leak existence

    const user = await prisma.user.findUnique({ where: { email: e.email } }).catch(() => null);
    if (!user) return res.status(200).json({ ok: true });

    const resetToken = jwt.sign({ sub: user.id, purpose: "reset" }, JWT_SECRET, { expiresIn: "1h" });
    await prisma.user.update({ where: { id: user.id }, data: { resetToken } });

    const resetUrl = `${APP_URL.replace(/\/$/, "")}/reset.html?token=${encodeURIComponent(resetToken)}`;

    try {
      await sendMail({
        to: e.email,
        subject: "Ügynökség — Jelszó visszaállítás",
        text: `Jelszó visszaállítás:\n${resetUrl}\n\nHa nem te kérted, hagyd figyelmen kívül.`,
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
    if (!requireEnv(res)) return;

    const token = pickString(req.body, ["token"]);
    const password = pickString(req.body, ["password", "pass", "pwd"]);

    if (!token) return res.status(400).json({ error: "Missing token." });
    if (!password || password.length < 6) return res.status(400).json({ error: "A jelszónak legalább 6 karakternek kell lennie." });

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(400).json({ error: "Invalid or expired token." });
    }
    if (payload?.purpose !== "reset" || !payload?.sub) return res.status(400).json({ error: "Invalid token." });

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.resetToken !== token) return res.status(400).json({ error: "Invalid token." });

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash, resetToken: null } });

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
