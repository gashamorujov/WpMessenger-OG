import { json } from '@/lib/api';
import { workerStatus } from '@/lib/waClient';
import config from '@/lib/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const wa = await workerStatus();
  return json({
    status: 'ok',
    version: config.version,
    db: true,
    whatsappWorker: { reachable: wa.reachable, sessions: wa.sessions.length },
  });
}
