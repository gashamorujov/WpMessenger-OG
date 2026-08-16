import { json, fail } from '@/lib/api';
import { authGuard } from '@/lib/auth';
import { settingsRepo, SETTING_KEYS } from '@/lib/repositories';
import config from '@/lib/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  if (!(await authGuard())) return fail('Unauthorized', 401);
  const [effective, overrides] = await Promise.all([settingsRepo.effective(), settingsRepo.getAll()]);
  return json({
    version: config.version,
    effective,
    overrides,
    env: {
      nextUrl: config.nextUrl,
      workerApiUrl: config.workerApiUrl,
      workerWsUrl: config.workerWsUrl,
      workerConfigured: !!(config.workerApiUrl && config.workerApiToken),
      database: config.isPostgres ? 'PostgreSQL' : 'SQLite',
    },
  });
}

export async function PUT(request) {
  if (!(await authGuard())) return fail('Unauthorized', 401);
  let body;
  try { body = await request.json(); } catch { return fail('Yanlış sorğu formatı'); }
  const overrides = body?.overrides || {};
  const validators = {
    broadcastDelayMinMs: (v) => Number.isInteger(v) && v >= 0 && v <= 600000,
    broadcastDelayMaxMs: (v) => Number.isInteger(v) && v >= 0 && v <= 600000,
    broadcastMaxRetries: (v) => Number.isInteger(v) && v >= 0 && v <= 20,
    duplicateSendTtlMin: (v) => Number.isInteger(v) && v >= 0 && v <= 1440,
    maxRecipients: (v) => Number.isInteger(v) && v >= 1 && v <= 100000,
    maxMessageLength: (v) => Number.isInteger(v) && v >= 1 && v <= 1000000,
    waPresenceCheck: (v) => typeof v === 'boolean',
    waSkipUnregistered: (v) => typeof v === 'boolean',
  };
  const invalid = [];
  for (const [key, value] of Object.entries(overrides)) {
    const validate = validators[key];
    if (!validate || !validate(value)) { invalid.push(key); continue; }
    await settingsRepo.set(key, value);
  }
  if (invalid.length) return fail(`Yanlış parametrlər: ${invalid.join(', ')}`);
  const [effective, all] = await Promise.all([settingsRepo.effective(), settingsRepo.getAll()]);
  return json({ ok: true, effective, overrides: all });
}
