import { json, fail } from '@/lib/api';
import { authGuard } from '@/lib/auth';
import { jobsRepo } from '@/lib/repositories';
import { jobSnapshot } from '@/lib/jobSnapshot';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request, { params }) {
  if (!(await authGuard())) return fail('Unauthorized', 401);
  const { id } = await params;
  const job = await jobsRepo.read(id);
  if (!job) return fail('İş tapılmadı', 404);
  return json(jobSnapshot(job));
}
