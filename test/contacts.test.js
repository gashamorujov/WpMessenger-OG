const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wpm-contacts-'));
process.env.DATA_DIR = tmp;
process.env.DATABASE_URL = path.join(tmp, 'app.db');

const { migrate, close, getDb } = require('../db');
const contacts = require('../db/contacts');

test('contacts: upsert + duplicate prevention across formats', () => {
  migrate();
  const a = contacts.upsert({ name: 'Əli Məmmədov', phone: '0503482680' });
  assert.equal(a.created, true);
  assert.equal(a.contact.normalizedPhone, '994503482680');
  assert.equal(a.contact.phone, '+994 50 348 26 80');

  // Same number, different format → duplicate, no new row
  const b = contacts.upsert({ name: 'Əli Məmmədov', phone: '+994503482680' });
  assert.equal(b.created, false);
  assert.equal(b.duplicate, true);

  // Same number, new name → updated
  const c = contacts.upsert({ name: 'Əli Məmmədov 2', phone: '9940503482680' });
  assert.equal(c.created, false);
  assert.equal(c.updated, true);
  assert.equal(c.contact.name, 'Əli Məmmədov 2');
});

test('contacts: invalid input rejected', () => {
  const r1 = contacts.upsert({ name: '', phone: '0503482680' });
  assert.equal(r1.contact, null);
  const r2 = contacts.upsert({ name: 'X', phone: '123' });
  assert.equal(r2.contact, null);
});

test('contacts: search + waStatus filter + pagination', () => {
  contacts.upsert({ name: 'Akif Babayev', phone: '055-123-45-67' });
  contacts.upsert({ name: 'Nərmin Quliyeva', phone: '0773648648' });
  contacts.setWaStatus('994503482680', 'yes');
  contacts.setWaStatus('994551234567', 'yes');

  const s = contacts.list({ q: 'quliyeva' });
  assert.equal(s.total, 1);
  assert.equal(s.items[0].name, 'Nərmin Quliyeva');

  const wa = contacts.list({ waStatus: 'yes' });
  assert.equal(wa.total, 2);

  const page = contacts.list({ page: 1, pageSize: 2 });
  assert.equal(page.items.length, 2);
  assert.ok(page.pages >= 2);
});

test('contacts: update + remove', () => {
  const created = contacts.upsert({ name: 'Test', phone: '0501112233' }).contact;
  const up = contacts.updateName(created.id, 'Test Yeniləndi');
  assert.equal(up.ok, true);
  assert.equal(up.contact.name, 'Test Yeniləndi');

  const ph = contacts.updatePhone(created.id, '0501112244');
  assert.equal(ph.ok, true);
  assert.equal(ph.contact.normalizedPhone, '994501112244');

  // Phone conflict rejected
  contacts.upsert({ name: 'Başqa', phone: '0501112255' });
  const conflict = contacts.updatePhone(created.id, '0501112255');
  assert.equal(conflict.ok, false);

  assert.equal(contacts.remove(created.id), true);
  assert.equal(contacts.remove(created.id), false);
});

test.after(() => { close(); });
