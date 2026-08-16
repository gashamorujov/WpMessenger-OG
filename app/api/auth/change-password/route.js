import { json, fail } from '@/lib/api';
import { authGuard } from '@/lib/auth';
import { usersRepo } from '@/lib/repositories';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request) {
  const token = await authGuard();
  if (!token) return fail('Unauthorized', 401);

  let body;
  try { body = await request.json(); } catch { return fail('Yanlış sorğu formatı'); }
  const { currentPassword, newPassword } = body || {};
  if (!currentPassword || !newPassword) {
    return fail('Cari şifrə və yeni şifrə tələb olunur');
  }

  const res = await usersRepo.changePassword(currentPassword, newPassword);
  if (!res.ok) return fail(res.error, 400);
  return json({ ok: true });
}
