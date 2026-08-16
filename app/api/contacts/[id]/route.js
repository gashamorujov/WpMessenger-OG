import { json, fail } from '@/lib/api';
import { authGuard } from '@/lib/auth';
import { contactsRepo } from '@/lib/repositories';
import { waClient } from '@/lib/waClientHelpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request, { params }) {
  if (!(await authGuard())) return fail('Unauthorized', 401);
  const { id } = await params;
  const contact = await contactsRepo.getById(id);
  if (!contact) return fail('Kontakt tapılmadı', 404);
  return json(contact);
}

export async function PUT(request, { params }) {
  if (!(await authGuard())) return fail('Unauthorized', 401);
  const { id } = await params;
  let body;
  try { body = await request.json(); } catch { return fail('Yanlış sorğu formatı'); }

  let contact = await contactsRepo.getById(id);
  if (!contact) return fail('Kontakt tapılmadı', 404);

  if (body.name !== undefined) {
    const r = await contactsRepo.updateName(id, body.name);
    if (!r.ok) return fail(r.reason);
    contact = r.contact;
  }
  if (body.phone !== undefined) {
    const r = await contactsRepo.updatePhone(id, body.phone);
    if (!r.ok) return fail(r.reason);
    contact = r.contact;
    waClient.mirrorContact(contact).catch(() => {});
  }
  return json({ ok: true, contact });
}

export async function DELETE(_request, { params }) {
  if (!(await authGuard())) return fail('Unauthorized', 401);
  const { id } = await params;
  if (!(await contactsRepo.remove(id))) return fail('Kontakt tapılmadı', 404);
  return json({ ok: true });
}
