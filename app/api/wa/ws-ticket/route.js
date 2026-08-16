import { json, fail } from '@/lib/api';
import { authGuard } from '@/lib/auth';
import waClient from '@/lib/waClient';
import config from '@/lib/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  if (!(await authGuard())) return fail('Unauthorized', 401);
  if (!waClient.isConfigured()) return fail('WhatsApp worker konfiqurasiya olunmayıb', 503);
  if (!config.workerWsUrl) return fail('WORKER_WS_URL təyin olunmayıb', 503);
  try {
    const d = await waClient.wsTicket();
    return json({ ticket: d.ticket, ttl: d.ttl || 120, url: config.workerWsUrl });
  } catch (e) {
    return fail(e.message, e.status || 502);
  }
}
