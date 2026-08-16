import { json, fail } from '@/lib/api';
import { authGuard } from '@/lib/auth';
import { jobsRepo } from '@/lib/repositories';
import { jobSnapshot } from '@/lib/jobSnapshot';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request) {
  if (!(await authGuard())) return fail('Unauthorized', 401);
  const sp = request.nextUrl.searchParams;
  const state = sp.get('state') && sp.get('state') !== 'all' ? sp.get('state') : '';
  const result = await jobsRepo.list({ state, q: sp.get('q') || '', page: sp.get('page') || 1, pageSize: sp.get('pageSize') || 15 });
  const items = result.items.filter((j) => ['completed', 'cancelled', 'interrupted'].includes(j.state));
  return json({ ...result, items: items.map(jobSnapshot), total: items.length, pages: Math.max(1, Math.ceil(items.length / result.pageSize)) });
}
