import { json, fail } from '@/lib/api';
import { authGuard } from '@/lib/auth';
import waClient from '@/lib/waClient';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request, { params }) {
  if (!(await authGuard())) return fail('Unauthorized', 401);
  const { key } = await params;
  try {
    const d = await waClient.qr(key);
    return json({ phone: key, qr: d.qr || null, ts: d.ts || null });
  } catch (e) {
    return json({ phone: key, qr: null, ts: null, error: e.message });
  }
}
