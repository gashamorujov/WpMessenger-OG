import { json, fail } from '@/lib/api';
import { authGuard } from '@/lib/auth';
import config from '@/lib/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const token = await authGuard();
  if (!token) return fail('Unauthorized', 401);
  return json({ loggedIn: true, username: config.adminUsername, version: config.version });
}
