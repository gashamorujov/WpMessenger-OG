import { json, fail } from '@/lib/api';
import { authGuard } from '@/lib/auth';
import { contactsRepo, jobsRepo, settingsRepo } from '@/lib/repositories';
import { jobSnapshot } from '@/lib/jobSnapshot';
import { workerStatus } from '@/lib/waClient';
import config from '@/lib/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  if (!(await authGuard())) return fail('Unauthorized', 401);

  const [wa, contactsCount, allJobs, activeJobs, effective] = await Promise.all([
    workerStatus(),
    contactsRepo.count(),
    jobsRepo.all(),
    jobsRepo.listActive(),
    settingsRepo.effective(),
  ]);

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayJobs = allJobs.filter((j) => new Date(j.createdAt).getTime() >= startOfDay.getTime());
  const today = {
    jobs: todayJobs.length,
    recipients: todayJobs.reduce((n, j) => n + j.targets.length, 0),
    success: todayJobs.reduce((n, j) => n + j.successCount, 0),
    fail: todayJobs.reduce((n, j) => n + j.failCount, 0),
    skip: todayJobs.reduce((n, j) => n + j.skipCount, 0),
  };

  return json({
    whatsapp: {
      reachable: wa.reachable,
      status: wa.reachable && wa.sessions.some((s) => s.status === 'connected') ? 'connected'
        : wa.reachable && wa.sessions.length ? wa.sessions[0].status : 'unreachable',
      connected: wa.sessions.filter((s) => s.status === 'connected').length,
      sessions: wa.sessions,
      error: wa.error || null,
    },
    contactsCount,
    today,
    activeJobs: activeJobs.map(jobSnapshot),
    activeCount: activeJobs.length,
    historyCount: allJobs.filter((j) => j.state === 'completed' || j.state === 'cancelled').length,
    version: config.version,
    workerConfigured: !!(config.workerApiUrl && config.workerApiToken),
  });
}


