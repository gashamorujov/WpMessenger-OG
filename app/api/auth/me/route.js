import { json, fail } from '@/lib/api';
import { authGuard } from '@/lib/auth';
import { usersRepo } from '@/lib/repositories';
import config from '@/lib/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const token = await authGuard();
  if (!token) return fail('Unauthorized', 401);
  const admin = await usersRepo.getAdmin();
  return json({ loggedIn: true, username: (admin && admin.username) || config.adminUsername, version: config.version });
}
