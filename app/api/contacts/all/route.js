import { json, fail } from '@/lib/api';
import { authGuard } from '@/lib/auth';
import { contactsRepo } from '@/lib/repositories';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  if (!(await authGuard())) return fail('Unauthorized', 401);
  const items = (await contactsRepo.all()).map((c) => ({
    id: c.id, name: c.name, normalizedPhone: c.normalizedPhone, whatsappStatus: c.whatsappStatus,
  }));
  return json({ items });
}
