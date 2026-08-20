import { json, fail } from '@/lib/api';
import { authGuard } from '@/lib/auth';
import { jobsRepo } from '@/lib/repositories';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request) {
  if (!(await authGuard())) return fail('Unauthorized', 401);
  let body;
  try { body = await request.json(); } catch { return fail('Yanlış sorğu formatı'); }
  const { ids } = body || {};
  if (!ids || !Array.isArray(ids) || ids.length === 0) return fail('Silmək üçün ID siyahısı tələb olunur');
  const deleted = [];
  for (const id of ids) {
    try {
      await jobsRepo.deleteJob(String(id));
      deleted.push(id);
    } catch {}
  }
  return json({ ok: true, deleted, count: deleted.length });
}

export async function DELETE(request) {
  if (!(await authGuard())) return fail('Unauthorized', 401);
  const sp = request.nextUrl.searchParams;
  const id = sp.get('id');
  if (!id) return fail('ID tələb olunur');
  try {
    await jobsRepo.deleteJob(String(id));
    return json({ ok: true, deleted: id });
  } catch (e) {
    return fail(e.message, 500);
  }
}
