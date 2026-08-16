import { NextResponse } from 'next/server';
import { json } from '@/lib/api';
import { authGuard, clearSessionCookie } from '@/lib/auth';
import { sessionsRepo } from '@/lib/repositories';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request) {
  const token = await authGuard();
  if (!token) return json({ ok: true });
  await sessionsRepo.destroy(token);
  return clearSessionCookie(NextResponse.json({ ok: true }), request);
}
