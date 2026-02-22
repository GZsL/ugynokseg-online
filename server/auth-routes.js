'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const db = require('./db');
const prisma = db?.prisma || db;

const { sendMail } = require('./mailer');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || '';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

const COOKIE_NAME = 'auth';
const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: true, // Render is HTTPS
  path: '/',
  maxAge: 1000 * 60 * 60 * 24 * 30
};

function pickString(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function normalizeEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  if (!email) return { ok: false, email: '', error: 'Hiányzó e-mail cím.' };
  if (!email.includes('@') || email.length < 5) return { ok: false, email, error: 'Hibás e-mail cím.' };
  return { ok: true, email };
}

function mustHaveSecret(res) {
  if (!JWT_SECRET) {
    res.status(500).json({ error: 'Server config error: JWT_SECRET missing' });
    return false;
  }
  return true;
}

function signAuth(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

// ---------- AUTH ROUTES ----------

// Register
router.post('/register', async (req, res) => {
  try {
    if (!mustHaveSecret(res)) return;

    const name = pickString(req.body, ['name', 'username', 'displayName']) || 'Játékos';
    const emailRaw = pickString(req.body, ['email', 'emailAddress', 'mail']);
    const password = pickString(req.body, ['password', 'pass', 'pwd']);

    const e = normalizeEmail(emailRaw);
    if (!e.ok) return res.status(400).json({ error: e.error });

    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'A jelszónak legalább 6 karakternek kell lennie.' });
    }

    const existing = await prisma.user.findUnique({ where: { email: e.email } });
    if (existing) return res.status(409).json({ error: 'Ezzel az e-mail címmel már van fiók.' });

    const passwordHash = await bcrypt.hash(password, 12);

    // Email verify token (store only hash)
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyTokenHash = await bcrypt.hash(verifyToken, 10);

    const user = await prisma.user.create({
      data: {
        email: e.email,
        name,
        passwordHash,
        emailVerified: false,
        verifyTokenHash,
        verifyTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    // Send email (do not fail registration if SMTP is broken)
    const verifyUrl = `${APP_URL.replace(/\/$/, '')}/verify.html?token=${encodeURIComponent(verifyToken)}&email=${encodeURIComponent(e.email)}`;
    let mailOk = false;
    try {
      await sendMail({
        to: e.email,
        subject: 'Ügynökség — Erősítsd meg a regisztrációdat',
        html: `
          <p>Szia <b>${escapeHtml(name)}</b>!</p>
          <p>Kattints az alábbi linkre a regisztráció megerősítéséhez:</p>
          <p><a href="${verifyUrl}">${verifyUrl}</a></p>
          <p>Ha nem te voltál, hagyd figyelmen kívül.</p>
        `
      });
      mailOk = true
    } catch (err) {
      console.error('send verify mail failed:', err?.message || err);
    }

    // Auto login cookie (even before verify)
    const token = signAuth(user);
    res.cookie(COOKIE_NAME, token, cookieOptions);

    return res.json({ ok: true, mailOk, needsVerify: true });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ error: 'Szerver hiba (register).' });
  }
});

// Verify
router.get('/verify', async (req, res) => {
  try {
    const token = pickString(req.query, ['token']);
    const emailRaw = pickString(req.query, ['email']);
    const e = normalizeEmail(emailRaw);
    if (!token || !e.ok) return res.status(400).send('Invalid verify link.');

    const user = await prisma.user.findUnique({ where: { email: e.email } });
    if (!user || !user.verifyTokenHash || !user.verifyTokenExpiresAt) return res.status(400).send('Invalid verify link.');

    if (new Date(user.verifyTokenExpiresAt).getTime() < Date.now()) {
      return res.status(400).send('Verify link expired.');
    }

    const ok = await bcrypt.compare(token, user.verifyTokenHash);
    if (!ok) return res.status(400).send('Invalid verify link.');

    await prisma.user.update({
      where: { email: e.email },
      data: { emailVerified: true, verifyTokenHash: null, verifyTokenExpiresAt: null }
    });

    // back to app
    const back = `${APP_URL.replace(/\/$/, '')}/intro.html?verified=1`;
    return res.redirect(back);
  } catch (err) {
    console.error('verify error:', err);
    return res.status(500).send('Server error');
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    if (!mustHaveSecret(res)) return;

    const emailRaw = pickString(req.body, ['email', 'emailAddress', 'mail']);
    const password = pickString(req.body, ['password', 'pass', 'pwd']);

    const e = normalizeEmail(emailRaw);
    if (!e.ok) return res.status(400).json({ error: e.error });

    const user = await prisma.user.findUnique({ where: { email: e.email } });
    if (!user) return res.status(401).json({ error: 'Hibás e-mail vagy jelszó.' });

    const ok = await bcrypt.compare(password || '', user.passwordHash || '');
    if (!ok) return res.status(401).json({ error: 'Hibás e-mail vagy jelszó.' });

    const token = signAuth(user);
    res.cookie(COOKIE_NAME, token, cookieOptions);
    return res.json({ ok: true });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Szerver hiba (login).' });
  }
});

// Logout
router.post('/logout', async (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

// Me
router.get('/me', async (req, res) => {
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

    return res.json({
      ok: true,
      user: { id: user.id, email: user.email, name: user.name, emailVerified: !!user.emailVerified }
    });
  } catch (err) {
    console.error('me error:', err);
    return res.status(500).json({ ok: false });
  }
});

// Forgot
router.post('/forgot', async (req, res) => {
  try {
    if (!mustHaveSecret(res)) return;

    const emailRaw = pickString(req.body, ['email', 'emailAddress', 'mail']);
    const e = normalizeEmail(emailRaw);
    // don't leak
    if (!e.ok) return res.json({ ok: true });

    const user = await prisma.user.findUnique({ where: { email: e.email } }).catch(() => null);
    if (!user) return res.json({ ok: true });

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = await bcrypt.hash(resetToken, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: { resetTokenHash, resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000) }
    });

    const resetUrl = `${APP_URL.replace(/\/$/, '')}/reset.html?token=${encodeURIComponent(resetToken)}&email=${encodeURIComponent(e.email)}`;

    try {
      await sendMail({
        to: e.email,
        subject: 'Ügynökség — Jelszó visszaállítás',
        html: `<p>Jelszó visszaállítás:</p><p><a href="${resetUrl}">${resetUrl}</a></p>`
      });
    } catch (err) {
      console.error('send reset mail failed:', err?.message || err);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('forgot error:', err);
    return res.status(500).json({ ok: false });
  }
});

// Reset
router.post('/reset', async (req, res) => {
  try {
    const token = pickString(req.body, ['token']);
    const emailRaw = pickString(req.body, ['email']);
    const password = pickString(req.body, ['password', 'pass', 'pwd']);

    const e = normalizeEmail(emailRaw);
    if (!token || !e.ok) return res.status(400).json({ error: 'Invalid request.' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'A jelszónak legalább 6 karakternek kell lennie.' });

    const user = await prisma.user.findUnique({ where: { email: e.email } });
    if (!user || !user.resetTokenHash || !user.resetTokenExpiresAt) return res.status(400).json({ error: 'Invalid token.' });

    if (new Date(user.resetTokenExpiresAt).getTime() < Date.now()) return res.status(400).json({ error: 'Token lejárt.' });

    const ok = await bcrypt.compare(token, user.resetTokenHash);
    if (!ok) return res.status(400).json({ error: 'Invalid token.' });

    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { email: e.email },
      data: { passwordHash, resetTokenHash: null, resetTokenExpiresAt: null }
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('reset error:', err);
    return res.status(500).json({ ok: false });
  }
});

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

module.exports = router;
