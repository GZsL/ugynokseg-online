'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const prisma = require('./db');
const { sendMail } = require('./mailer');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

function signAuthToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '30d' });
}

function setAuthCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('auth', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
}

function clearAuthCookie(res) {
  res.clearCookie('auth');
}

function requireBodyFields(fields) {
  return (req, res, next) => {
    for (const f of fields) {
      if (req.body?.[f] == null || String(req.body[f]).trim() === '') {
        return res.status(400).json({ error: `Missing field: ${f}` });
      }
    }
    next();
  };
}

router.post('/register', requireBodyFields(['email', 'password']), async (req, res) => {
  try {
    const email = String(req.body.email).trim().toLowerCase();
    const password = String(req.body.password);
    const name = req.body.name ? String(req.body.name).trim() : null;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 12);

    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyTokenHash = await bcrypt.hash(verifyToken, 10);

    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        emailVerified: false,
        verifyTokenHash,
        verifyTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    const verifyUrl = `${APP_URL}/verify.html?token=${encodeURIComponent(verifyToken)}&email=${encodeURIComponent(email)}`;

    await sendMail({
      to: email,
      subject: 'Erősítsd meg a regisztrációdat',
      html: `
        <p>Szia${name ? ` ${name}` : ''}!</p>
        <p>Kérlek erősítsd meg a regisztrációdat az alábbi linkre kattintva:</p>
        <p><a href="${verifyUrl}">${verifyUrl}</a></p>
        <p>A link 24 óráig érvényes.</p>
      `
    });

    res.json({ ok: true, userId: user.id });
  } catch (e) {
    console.error('register error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/verify', requireBodyFields(['email', 'token']), async (req, res) => {
  try {
    const email = String(req.body.email).trim().toLowerCase();
    const token = String(req.body.token).trim();

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.emailVerified) return res.json({ ok: true, alreadyVerified: true });

    if (!user.verifyTokenHash || !user.verifyTokenExpiresAt) {
      return res.status(400).json({ error: 'No verification token. Please resend.' });
    }
    if (user.verifyTokenExpiresAt.getTime() < Date.now()) {
      return res.status(400).json({ error: 'Verification token expired. Please resend.' });
    }

    const matches = await bcrypt.compare(token, user.verifyTokenHash);
    if (!matches) return res.status(400).json({ error: 'Invalid token' });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        verifyTokenHash: null,
        verifyTokenExpiresAt: null
      }
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('verify error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', requireBodyFields(['email', 'password']), async (req, res) => {
  try {
    const email = String(req.body.email).trim().toLowerCase();
    const password = String(req.body.password);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    if (!user.emailVerified) return res.status(403).json({ error: 'Email not verified' });

    const token = signAuthToken(user.id);
    setAuthCookie(res, token);

    res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } });
  } catch (e) {
    console.error('login error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/logout', async (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  try {
    const token = req.cookies?.auth;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const userId = payload?.sub;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } });
  } catch (e) {
    console.error('me error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/forgot', requireBodyFields(['email']), async (req, res) => {
  try {
    const email = String(req.body.email).trim().toLowerCase();

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.json({ ok: true });

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = await bcrypt.hash(resetToken, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetTokenHash,
        resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000)
      }
    });

    const resetUrl = `${APP_URL}/reset.html?token=${encodeURIComponent(resetToken)}&email=${encodeURIComponent(email)}`;

    await sendMail({
      to: email,
      subject: 'Jelszó visszaállítás',
      html: `
        <p>Jelszó visszaállítást kértél.</p>
        <p>Új jelszó beállítása:</p>
        <p><a href="${resetUrl}">${resetUrl}</a></p>
        <p>A link 1 óráig érvényes.</p>
      `
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('forgot error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/reset', requireBodyFields(['email', 'token', 'password']), async (req, res) => {
  try {
    const email = String(req.body.email).trim().toLowerCase();
    const token = String(req.body.token).trim();
    const password = String(req.body.password);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(400).json({ error: 'Invalid token' });

    if (!user.resetTokenHash || !user.resetTokenExpiresAt) {
      return res.status(400).json({ error: 'Invalid token' });
    }
    if (user.resetTokenExpiresAt.getTime() < Date.now()) {
      return res.status(400).json({ error: 'Reset token expired' });
    }

    const matches = await bcrypt.compare(token, user.resetTokenHash);
    if (!matches) return res.status(400).json({ error: 'Invalid token' });

    const passwordHash = await bcrypt.hash(password, 12);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetTokenHash: null,
        resetTokenExpiresAt: null
      }
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('reset error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// IMPORTANT: export router directly
module.exports = router;
