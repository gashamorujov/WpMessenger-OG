/**
 * Higher-level worker helpers used by Route Handlers:
 * mirror contacts to WhatsApp + update registration status.
 */
const waClient = require('./waClient');

async function mirrorContact(contact) {
  try {
    await waClient.request('/api/contact-mirror', { method: 'POST', body: { name: contact.name, normalizedPhone: contact.normalizedPhone } });
  } catch {}
  try {
    const d = await waClient.request('/api/check-registered', { method: 'POST', body: { phones: [contact.normalizedPhone] } });
    if (d && d.results && d.results[contact.normalizedPhone] !== undefined) {
      const { contactsRepo } = require('./repositories');
      await contactsRepo.setWaStatus(contact.normalizedPhone, d.results[contact.normalizedPhone] ? 'yes' : 'no');
    }
  } catch {}
}

module.exports = { waClient: { mirrorContact } };
