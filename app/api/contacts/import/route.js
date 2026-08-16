import { json, fail } from '@/lib/api';
import { authGuard } from '@/lib/auth';
import { contactsRepo } from '@/lib/repositories';
import * as firebaseRealtime from '@/lib/firebase';
import { waClient } from '@/lib/waClientHelpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request) {
  if (!(await authGuard())) return fail('Unauthorized', 401);
  let body;
  try { body = await request.json(); } catch { return fail('Yanlış sorğu formatı'); }
  const list = Array.isArray(body?.contacts) ? body.contacts : [];
  if (list.length === 0) return fail('Kontakt siyahısı boşdur');
  if (list.length > 5000) return fail('Maksimum 5000 kontakt import edilə bilər');

  const summary = { created: 0, updated: 0, duplicates: 0, invalid: 0, errors: [] };
  for (const item of list) {
    const r = await contactsRepo.upsert({ name: item.name, phone: item.phone });
    if (!r.contact) {
      summary.invalid++;
      summary.errors.push({ name: item.name, phone: item.phone, reason: r.reason || 'Yanlış məlumat' });
    } else if (r.created) summary.created++;
    else if (r.duplicate) summary.duplicates++;
    else summary.updated++;
  }
  firebaseRealtime.publish('contacts:changed', {});
  return json(summary);
}
