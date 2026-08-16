import { NextResponse } from 'next/server';
import { json, fail } from '@/lib/api';
import { rateLimit, clientIp } from '@/lib/rateLimit';
import { usersRepo, sessionsRepo } from '@/lib/repositories';
import { setSessionCookie } from '@/lib/auth';
import config from '@/lib/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request) {
  const rl = rateLimit(`login:${clientIp(request)}`, { max: config.loginRateLimitMax });
  if (rl.limited) return fail('Çox tez-tez sorğu göndərilir. Bir az gözləyin.', 429);

  let body;
  try { body = await request.json(); } catch { return fail('Yanlış sorğu formatı'); }
  const { username, password } = body || {};
  if (!username || !password) return fail('İstifadəçi adı və şifrə tələb olunur');

  // First login: bootstrap the admin from ADMIN_USERNAME/ADMIN_PASSWORD (or defaults).
  try {
    await usersRepo.ensureAdmin();
  } catch (e) {
    return fail('Verilənlər bazasına yazıla bilmir: ' + e.message + '. Persistent database (PostgreSQL) təyin edin.', 500);
  }

  const ok = await usersRepo.verify(username, password);
  if (!ok) return fail('İstifadəçi adı və ya şifrə yanlışdır', 401);

  const token = await sessionsRepo.create(request.headers.get('user-agent') || '', clientIp(request));
  const res = NextResponse.json({ token, username: String(username).trim(), version: config.version });
  return setSessionCookie(res, token, request);
}
