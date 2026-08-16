/**
 * Auth helpers for Next.js Route Handlers.
 * Sessions are stored in the database; the browser holds an httpOnly cookie.
 */
const { cookies } = require('next/headers');
const { NextResponse } = require('next/server');
const config = require('./config');
const { sessionsRepo } = require('./repositories');

async function getSessionToken() {
  try {
    const store = await cookies();
    const c = store.get(config.cookieName);
    if (c && c.value) return c.value;
  } catch {}
  return null;
}

async function requireAuth() {
  const token = await getSessionToken();
  if (!token) return null;
  const ok = await sessionsRepo.isValid(token).catch(() => false);
  return ok ? token : null;
}

async function authGuard() {
  const token = await requireAuth();
  if (!token) return null;
  return token;
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production';
  res.cookies.set(config.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: Math.floor(config.sessionTtlMs / 1000),
    path: '/',
  });
  return res;
}

function clearSessionCookie(res) {
  res.cookies.set(config.cookieName, '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 0, path: '/' });
  return res;
}

async function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

module.exports = { getSessionToken, requireAuth, authGuard, setSessionCookie, clearSessionCookie, unauthorized };
