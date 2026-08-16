import { json, fail } from '@/lib/api';
import { authGuard } from '@/lib/auth';
import { jobsRepo } from '@/lib/repositories';
import { jobSnapshot } from '@/lib/jobSnapshot';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request) {
  if (!(await authGuard())) return fail('Unauthorized', 401);
  const sp = request.nextUrl.searchParams;
  if (sp.get('state') === 'active') {
    const items = (await jobsRepo.listActive()).map(jobSnapshot);
    return json({ items, total: items.length, page: 1, pageSize: items.length, pages: 1 });
  }
  const result = await jobsRepo.list({ state: sp.get('state') || 'all', q: sp.get('q') || '', page: sp.get('page') || 1, pageSize: sp.get('pageSize') || 20 });
  return json({ ...result, items: result.items.map(jobSnapshot) });
}
