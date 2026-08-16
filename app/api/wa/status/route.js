import { json, fail } from '@/lib/api';
import { authGuard } from '@/lib/auth';
import waClient from '@/lib/waClient';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  if (!(await authGuard())) return fail('Unauthorized', 401);
  if (!waClient.isConfigured()) return json({ sessions: [], configured: false });
  try {
    const d = await waClient.status();
    return json({ sessions: d.sessions || [], configured: true });
  } catch (e) {
    return fail(e.message, e.status || 502);
  }
}
