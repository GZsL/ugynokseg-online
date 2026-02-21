const jwt = require('jsonwebtoken');

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'ugynokseg_auth';

function getTokenFromRequest(req) {
  // Cookie
  if (req.cookies && req.cookies[COOKIE_NAME]) return req.cookies[COOKIE_NAME];

  // Bearer token fallback (useful for API testing)
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function requireAuth(req, res, next) {
  const secret = process.env.JWT_SECRET;
  if (!secret) return res.status(500).json({ error: 'JWT_SECRET missing' });

  const token = getTokenFromRequest(req);
  if (!token) return res.status(401).json({ error: 'AUTH_REQUIRED' });

  try {
    const payload = jwt.verify(token, secret);
    // Common fields used in auth-routes.js: { sub, email, name }
    req.auth = payload;
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'AUTH_INVALID' });
  }
}

module.exports = { requireAuth };
