const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getPrisma } = require('./db');
const { sendMail } = require('./mailer');

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'ugynokseg_auth';
const JWT_SECRET = process.env.JWT_SECRET || '';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';
const APP_URL = process.env.APP_URL || '';

function requireJwtSecret() {
  if (!JWT_SECRET || JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET is missing or too short (min 32 chars).');
  }
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function authCookieOptions(req) {
  // Render uses HTTPS; trust proxy is enabled in index.js
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000
  };
}

function setAuthCookie(res, req, payload) {
  requireJwtSecret();
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  res.cookie(COOKIE_NAME, token, authCookieOptions(req));
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function getAuthUser(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    requireJwtSecret();
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const u = getAuthUser(req);
  if (!u?.userId) return res.status(401).json({ error: 'auth_required' });
  req.auth = u;
  next();
}

function makeRouter(express) {
  const router = express.Router();
  const prisma = getPrisma();

  // Register
  router.post('/register', async (req, res) => {
    try {
      const email = String(req.body.email || '').trim().toLowerCase();
      const password = String(req.body.password || '');
      const name = String(req.body.name || '').trim() || null;

      if (!email || !email.includes('@')) return res.status(400).json({ error: 'invalid_email' });
      if (password.length < 8) return res.status(400).json({ error: 'weak_password' });

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) return res.status(409).json({ error: 'email_taken' });

      const passwordHash = await bcrypt.hash(password, 12);
      const user = await prisma.user.create({
        data: { email, name, passwordHash, emailVerified: false }
      });

      const token = randomToken(32);
      const tokenHash = sha256(token);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await prisma.emailVerificationToken.create({
        data: { tokenHash, userId: user.id, expiresAt }
      });

      const verifyLink = APP_URL
        ? `${APP_URL}/verify.html?token=${encodeURIComponent(token)}`
        : null;

      if (verifyLink) {
        await sendMail({
          to: email,
          subject: 'Ügynökség – email megerősítés',
          html: `<p>Szia!</p><p>Kérlek erősítsd meg az emailed:</p><p><a href="${verifyLink}">${verifyLink}</a></p><p>A link 24 óráig érvényes.</p>`
        });
      }

      res.json({ ok: true, userId: user.id, emailSent: !!verifyLink });
    } catch (e) {
      console.error('register_error', e);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // Verify email
  router.post('/verify', async (req, res) => {
    try {
      const token = String(req.body.token || '');
      if (!token) return res.status(400).json({ error: 'missing_token' });

      const tokenHash = sha256(token);
      const rec = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } });
      if (!rec) return res.status(400).json({ error: 'invalid_token' });
      if (rec.expiresAt.getTime() < Date.now()) return res.status(400).json({ error: 'expired_token' });

      await prisma.user.update({ where: { id: rec.userId }, data: { emailVerified: true } });
      await prisma.emailVerificationToken.delete({ where: { tokenHash } });

      res.json({ ok: true });
    } catch (e) {
      console.error('verify_error', e);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // Resend verification
  router.post('/resend-verification', async (req, res) => {
    try {
      const email = String(req.body.email || '').trim().toLowerCase();
      if (!email) return res.json({ ok: true }); // don't leak

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || user.emailVerified) return res.json({ ok: true });

      // Delete old tokens
      await prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } });

      const token = randomToken(32);
      const tokenHash = sha256(token);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await prisma.emailVerificationToken.create({ data: { tokenHash, userId: user.id, expiresAt } });

      const verifyLink = APP_URL ? `${APP_URL}/verify.html?token=${encodeURIComponent(token)}` : null;
      if (verifyLink) {
        await sendMail({
          to: email,
          subject: 'Ügynökség – email megerősítés (új)',
          html: `<p>Szia!</p><p>Új megerősítő link:</p><p><a href="${verifyLink}">${verifyLink}</a></p>`
        });
      }

      res.json({ ok: true });
    } catch (e) {
      console.error('resend_verify_error', e);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // Login
  router.post('/login', async (req, res) => {
    try {
      const email = String(req.body.email || '').trim().toLowerCase();
      const password = String(req.body.password || '');

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return res.status(401).json({ error: 'invalid_credentials' });

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

      if (!user.emailVerified) return res.status(403).json({ error: 'email_not_verified' });

      setAuthCookie(res, req, { userId: user.id, email: user.email });
      res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } });
    } catch (e) {
      console.error('login_error', e);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // Logout
  router.post('/logout', async (req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
  });

  // Who am I
  router.get('/me', (req, res) => {
    const u = getAuthUser(req);
    if (!u?.userId) return res.status(401).json({ error: 'auth_required' });
    res.json({ ok: true, auth: u });
  });

  // Forgot password
  router.post('/forgot', async (req, res) => {
    try {
      const email = String(req.body.email || '').trim().toLowerCase();
      // Always return ok to avoid account enumeration
      if (!email) return res.json({ ok: true });

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return res.json({ ok: true });

      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

      const token = randomToken(32);
      const tokenHash = sha256(token);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h

      await prisma.passwordResetToken.create({ data: { tokenHash, userId: user.id, expiresAt } });

      const resetLink = APP_URL ? `${APP_URL}/reset.html?token=${encodeURIComponent(token)}` : null;
      if (resetLink) {
        await sendMail({
          to: email,
          subject: 'Ügynökség – jelszó visszaállítás',
          html: `<p>Szia!</p><p>Jelszó visszaállítás:</p><p><a href="${resetLink}">${resetLink}</a></p><p>A link 1 óráig érvényes.</p>`
        });
      }

      res.json({ ok: true });
    } catch (e) {
      console.error('forgot_error', e);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // Reset password
  router.post('/reset', async (req, res) => {
    try {
      const token = String(req.body.token || '');
      const newPassword = String(req.body.newPassword || '');

      if (!token) return res.status(400).json({ error: 'missing_token' });
      if (newPassword.length < 8) return res.status(400).json({ error: 'weak_password' });

      const tokenHash = sha256(token);
      const rec = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
      if (!rec) return res.status(400).json({ error: 'invalid_token' });
      if (rec.expiresAt.getTime() < Date.now()) return res.status(400).json({ error: 'expired_token' });

      const passwordHash = await bcrypt.hash(newPassword, 12);
      await prisma.user.update({ where: { id: rec.userId }, data: { passwordHash } });
      await prisma.passwordResetToken.delete({ where: { tokenHash } });

      res.json({ ok: true });
    } catch (e) {
      console.error('reset_error', e);
      res.status(500).json({ error: 'server_error' });
    }
  });

  return { router, requireAuth };
}

module.exports = { makeRouter, requireAuth, getAuthUser };
