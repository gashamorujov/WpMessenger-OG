import { json, fail } from '@/lib/api';
import { authGuard } from '@/lib/auth';
import { jobsRepo } from '@/lib/repositories';
import { jobSnapshot } from '@/lib/jobSnapshot';
import waClient from '@/lib/waClient';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_request, { params }) {
  if (!(await authGuard())) return fail('Unauthorized', 401);
  const { id } = await params;
  const old = await jobsRepo.read(id);
  if (!old) return fail('İş tapılmadı', 404);
  const failed = old.targets.filter((t) => t.status === 'failed');
  if (failed.length === 0) return fail('Yenidən cəhd ediləcək uğursuz nömrə yoxdur', 404);
  if (!waClient.isConfigured()) return fail('WhatsApp worker konfiqurasiya olunmayıb', 503);

  const job = await jobsRepo.create({ type: old.type, payloadSpec: old.payloadSpec, targets: failed.map((t) => ({ phone: t.phone, name: t.name })) });
  await waClient.notifyJob(job.id).catch(() => jobsRepo.markInterrupted(job));
  return json({ job: jobSnapshot(await jobsRepo.read(job.id)) }, 201);
}
