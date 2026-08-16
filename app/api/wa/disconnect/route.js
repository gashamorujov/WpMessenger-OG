import { json, fail } from '@/lib/api';
import { authGuard } from '@/lib/auth';
import waClient from '@/lib/waClient';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request) {
  if (!(await authGuard())) return fail('Unauthorized', 401);
  let body;
  try { body = await request.json(); } catch { return fail('Yanlış sorğu formatı'); }
  if (!body.phone) return fail('Nömrə tələb olunur');
  try { await waClient.disconnect({ phone: body.phone }); } catch (e) { return fail(e.message, e.status || 502); }
  return json({ ok: true });
}
