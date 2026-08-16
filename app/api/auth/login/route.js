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
  const { password } = body || {};
  if (!password) return fail('Şifrə tələb olunur');

  // First login: bootstrap the admin password from ADMIN_PASSWORD (or default).
  try {
    await usersRepo.ensureAdmin();
  } catch (e) {
    return fail('Firebase verilənlər bazasına bağlanmaq mümkün olmadı: ' + e.message, 500);
  }

  const ok = await usersRepo.verify(null, password);
  if (!ok) return fail('Şifrə yanlışdır', 401);

  const token = await sessionsRepo.create(request.headers.get('user-agent') || '', clientIp(request));
  const admin = await usersRepo.getAdmin();
  const res = NextResponse.json({ token, username: (admin && admin.username) || config.adminUsername, version: config.version });
  return setSessionCookie(res, token, request);
}
