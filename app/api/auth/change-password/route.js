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
  const { currentPassword, username, newPassword } = body || {};
  if (!currentPassword || !username || !newPassword) {
    return fail('Cari şifrə, yeni istifadəçi adı və yeni şifrə tələb olunur');
  }

  const res = await usersRepo.changeCredentials(currentPassword, username, newPassword);
  if (!res.ok) return fail(res.error, 400);
  return json({ ok: true, username: res.username });
}
