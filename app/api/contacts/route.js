import { json, fail } from '@/lib/api';
import { authGuard } from '@/lib/auth';
import { contactsRepo } from '@/lib/repositories';
import { waClient } from '@/lib/waClientHelpers';
import * as firebaseRealtime from '@/lib/firebase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request) {
  if (!(await authGuard())) return fail('Unauthorized', 401);
  const sp = request.nextUrl.searchParams;
  const result = await contactsRepo.list({
    q: sp.get('q') || '',
    waStatus: sp.get('waStatus') || 'all',
    page: sp.get('page') || 1,
    pageSize: sp.get('pageSize') || 20,
  });
  return json(result);
}

export async function POST(request) {
  if (!(await authGuard())) return fail('Unauthorized', 401);
  let body;
  try { body = await request.json(); } catch { return fail('Yanlış sorğu formatı'); }
  const result = await contactsRepo.upsert({ name: body.name, phone: body.phone });
  if (!result.contact) return fail(result.reason || 'Kontakt yaradıla bilmədi');
  firebaseRealtime.publish('contacts:changed', {});
  if (result.created) waClient.mirrorContact(result.contact).catch(() => {});
  return json(result, result.created ? 201 : 200);
}
