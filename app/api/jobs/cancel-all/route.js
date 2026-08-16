import { json, fail } from '@/lib/api';
import { authGuard } from '@/lib/auth';
import { jobsRepo } from '@/lib/repositories';
import waClient from '@/lib/waClient';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  if (!(await authGuard())) return fail('Unauthorized', 401);
  const active = await jobsRepo.listActive();
  for (const job of active) {
    await jobsRepo.markCancelled(job);
    if (waClient.isConfigured()) await waClient.cancelJob(job.id).catch(() => {});
  }
  return json({ ok: true, cancelled: active.length });
}
