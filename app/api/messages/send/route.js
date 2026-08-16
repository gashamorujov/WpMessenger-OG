import { json, fail } from '@/lib/api';
import { authGuard } from '@/lib/auth';
import { contactsRepo, jobsRepo, settingsRepo } from '@/lib/repositories';
import waClient from '@/lib/waClient';
import { normalizePhone, isValidAzerbaijanMobile, cleanName, extractNumbers } from '@/lib/phone';
import { jobSnapshot } from '@/lib/jobSnapshot';
import config from '@/lib/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function resolveRecipients(body) {
  const mode = body.recipientsMode || 'single';
  const effective = await settingsRepo.effective();
  const out = [];
  const errors = [];
  const pushPhone = (raw, name) => {
    const normalized = normalizePhone(raw);
    if (!normalized || !isValidAzerbaijanMobile(normalized)) {
      errors.push(`${name ? name + ': ' : ''}${raw} — yanlış nömrə`);
      return;
    }
    if (!out.some((t) => t.phone === normalized)) out.push({ phone: normalized, name: cleanName(name) || null });
  };

  if (mode === 'single') {
    if (body.phone) pushPhone(body.phone, '');
  } else if (mode === 'list') {
    const { numbers, invalid } = extractNumbers(body.numbers || '');
    for (const n of numbers) pushPhone(n, '');
    for (const n of invalid) errors.push(`${n} — yanlış nömrə`);
  } else if (mode === 'contacts') {
    let ids = [];
    try { ids = Array.isArray(body.contactIds) ? body.contactIds : JSON.parse(body.contactIds || '[]'); } catch { ids = []; }
    for (const id of ids) {
      const c = await contactsRepo.getById(id);
      if (c) pushPhone(c.normalizedPhone, c.name);
      else errors.push(`Kontakt #${id} tapılmadı`);
    }
  } else if (mode === 'all') {
    for (const c of await contactsRepo.all()) pushPhone(c.normalizedPhone, c.name);
  }

  if (out.length > effective.maxRecipients) {
    errors.push(`Maksimum ${effective.maxRecipients} alıcı göndərilə bilər`);
    out.length = effective.maxRecipients;
  }
  return { phones: out, errors };
}

export async function POST(request) {
  if (!(await authGuard())) return fail('Unauthorized', 401);
  if (!waClient.isConfigured()) {
    return fail('WhatsApp worker konfiqurasiya olunmayıb (WORKER_API_URL / WORKER_API_TOKEN). Backend Railway/VPS-də işləməlidir.', 503);
  }

  let form;
  try { form = await request.formData(); } catch { return fail('Multipart form tələb olunur'); }

  const body = {};
  for (const key of ['recipientsMode', 'phone', 'numbers', 'contactIds', 'text', 'caption', 'messageType', 'fileName']) {
    const v = form.get(key);
    if (v != null) body[key] = typeof v === 'string' ? v : v;
  }
  const file = form.get('file');

  const { phones, errors } = await resolveRecipients(body);
  if (errors.length) return fail(errors.join('\n'));
  if (phones.length === 0) return fail('Ən azı bir alıcı seçin və ya nömrə daxil edin');

  // Text or media payload
  let payloadSpec;
  if (file && typeof file !== 'string') {
    if (file.size > config.maxUploadBytes) return fail(`Fayl çox böyükdür (maksimum ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB)`);
    const buf = Buffer.from(await file.arrayBuffer());
    let type = body.messageType || '';
    if (!type) {
      const mt = (file.type || '').toLowerCase();
      if (mt.startsWith('image/')) type = 'image';
      else if (mt.startsWith('video/')) type = 'video';
      else if (mt.startsWith('audio/')) type = mt.includes('opus') || mt.includes('ogg') ? 'voice' : 'audio';
      else type = 'document';
    }
    let upload;
    try {
      upload = await waClient.upload(buf, body.fileName || file.name || 'file', file.type || 'application/octet-stream');
    } catch (e) {
      return fail(e.message, e.status || 502);
    }
    payloadSpec = {
      type,
      fileId: upload.fileId,
      fileName: body.fileName || file.name || 'file',
      mimetype: file.type || 'application/octet-stream',
    };
    if (body.caption) payloadSpec.caption = String(body.caption).slice(0, 2000);
  } else {
    const text = String(body.text || '').trim();
    if (!text) return fail('Mesaj mətni boş ola bilməz');
    const effective = await settingsRepo.effective();
    if (text.length > effective.maxMessageLength) return fail(`Mesaj çox uzundur (maksimum ${effective.maxMessageLength} simvol)`);
    payloadSpec = { type: 'text', text };
  }

  const job = await jobsRepo.create({ type: payloadSpec.type, payloadSpec, targets: phones });
  try {
    await waClient.notifyJob(job.id);
  } catch (e) {
    // Worker unreachable: job stays queued in DB; worker picks it up on resume.
    await jobsRepo.markInterrupted(job);
  }
  return json({ job: jobSnapshot(job) }, 201);
}

