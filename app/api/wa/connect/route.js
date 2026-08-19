import { json, fail } from '@/lib/api';
import { authGuard } from '@/lib/auth';
import waClient from '@/lib/waClient';
import { normalizePhone, isValidAzerbaijanMobile } from '@/lib/phone';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request) {
  if (!(await authGuard())) return fail('Unauthorized', 401);
  if (!waClient.isConfigured()) return fail('WhatsApp worker konfiqurasiya olunmayıb', 503);
  let body;
  try { body = await request.json(); } catch { return fail('Yanlış sorğu formatı'); }
  const isQr = body.method === 'qr';
  if (isQr && (!body.phone || body.phone === 'main')) {
    try {
      const d = await waClient.connect({ phone: 'main', method: 'qr' });
      return json({ ok: true, phone: d.phone || 'main' });
    } catch (e) { return fail(e.message, e.status || 502); }
  }
  const normalized = normalizePhone(body.phone);
  if (!normalized || !isValidAzerbaijanMobile(normalized)) {
    return fail('Yanlış nömrə formatı. Nümunə: 0503482680 və ya +994503482680');
  }
  try {
    await waClient.connect({ phone: normalized, method: isQr ? 'qr' : 'pair' });
    return json({ ok: true, phone: normalized });
  } catch (e) {
    return fail(e.message, e.status || 502);
  }
}
