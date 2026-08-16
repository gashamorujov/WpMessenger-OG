import { json, fail } from '@/lib/api';
import { authGuard } from '@/lib/auth';
import waClient from '@/lib/waClient';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request, { params }) {
  if (!(await authGuard())) return fail('Unauthorized', 401);
  const { phone } = await params;
  try {
    const d = await waClient.pair(phone);
    return json({ phone, code: d.code || null, ts: d.ts || null });
  } catch (e) {
    return json({ phone, code: null, ts: null, error: e.message });
  }
}
