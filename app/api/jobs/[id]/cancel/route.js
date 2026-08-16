import { json, fail } from '@/lib/api';
import { authGuard } from '@/lib/auth';
import { jobsRepo } from '@/lib/repositories';
import waClient from '@/lib/waClient';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_request, { params }) {
  if (!(await authGuard())) return fail('Unauthorized', 401);
  const { id } = await params;
  const job = await jobsRepo.read(id);
  if (!job) return fail('İş tapılmadı', 404);
  if (job.state !== 'running' && job.state !== 'interrupted') return fail('İş artıq sonlanıb', 404);
  await jobsRepo.markCancelled(job);
  if (waClient.isConfigured()) {
    await waClient.cancelJob(id).catch(() => {});
  }
  return json({ ok: true });
}
