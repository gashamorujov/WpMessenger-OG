/**
 * azPhone — phone number validation & normalization.
 *
 * Supports Azerbaijani and international numbers.
 * Azerbaijani numbers → 994XXXXXXXXX (12 digits, no separators).
 * International numbers → E.164 format (+CCXXXXXXXXXX).
 *
 * Supported input formats (all equivalent for AZ):
 *   +994501234567    994501234567    0501234567    501234567
 *   050 123 45 67    055-123-45-67   +994 50 123 45 67
 *   (050)1234567     050.123.45.67
 *
 * International numbers:
 *   +447911123456    905xxxxxxxxx    +905xxxxxxxxx
 *   Any number starting with + followed by country code.
 */

const COUNTRY_CODE = '994';
const LOCAL_LENGTH = 10; // 0 + prefix(2) + subscriber(7)
const INTERNATIONAL_LENGTH = 12; // 994 + prefix(2) + subscriber(7)

const MOBILE_PREFIXES = ['10', '50', '51', '55', '60', '70', '77', '99'];

/** Strip every non-digit character from a raw input. */
function digitsOnly(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw).replace(/\D/g, '');
}

/**
 * Detect if a raw input looks like an Azerbaijani number (local or international with 994).
 */
function isAzerbaijaniInput(raw) {
  const digits = digitsOnly(raw);
  if (!digits) return false;
  // Starts with +994 or 994 or 0 + az prefix
  if (digits.startsWith(COUNTRY_CODE)) return true;
  if (digits.length >= 2 && digits.startsWith('0') && MOBILE_PREFIXES.includes(digits.slice(1, 3))) return true;
  if (digits.length >= 2 && !digits.startsWith('0') && MOBILE_PREFIXES.includes(digits.slice(0, 2))) return true;
  return false;
}

/**
 * Normalize an Azerbaijani phone number to 994XXXXXXXXX.
 * Returns null if not a valid AZ number.
 */
function normalizeAzerbaijani(digits) {
  let candidate = null;

  // +994501234567 / 994501234567
  if (digits.length === INTERNATIONAL_LENGTH && digits.startsWith(COUNTRY_CODE)) {
    candidate = digits;
  }
  // 0501234567 (leading national 0)
  else if (digits.length === LOCAL_LENGTH && digits.startsWith('0')) {
    candidate = COUNTRY_CODE + digits.slice(1);
  }
  // 501234567 (local without leading 0, 9 digits)
  else if (digits.length === LOCAL_LENGTH - 1 && !digits.startsWith('0')) {
    candidate = COUNTRY_CODE + digits;
  }
  // 9940501234567 (ölkə kodu + yerli 0) — "9940" + 9 rəqəm
  else if (digits.length === 13 && digits.startsWith(COUNTRY_CODE + '0')) {
    candidate = COUNTRY_CODE + digits.slice(4);
  }
  // 11 digits starting with 0 (0 + 10 digit az number without cc)
  else if (digits.length === 11 && digits.startsWith('0')) {
    candidate = COUNTRY_CODE + digits.slice(1);
  }

  if (candidate && isValidAzerbaijanMobile(candidate)) return candidate;
  return null;
}

/**
 * Normalize an international (non-AZ) phone number to E.164 format.
 * Accepts +CC numbers or raw digits with country code.
 * Returns null if not a valid international number.
 */
function normalizeInternational(digits, raw) {
  // Must start with + in original input to be treated as international non-AZ
  const hasPlus = String(raw || '').trim().startsWith('+');
  
  if (hasPlus) {
    // E.164: 7-15 digits after stripping +
    if (digits.length >= 7 && digits.length <= 15) {
      return '+' + digits;
    }
  }
  
  // Without + but clearly international (e.g., 447911123456 for UK)
  // Only accept if the original had + or if it's clearly not an AZ number
  if (!hasPlus && digits.length >= 7 && digits.length <= 15) {
    // Check if it could be misinterpreted as AZ (don't convert AZ numbers here)
    if (!isAzerbaijaniInput(digits)) {
      // Still can't be sure without +, return null to be safe
      // Unless user explicitly typed with separators that suggest international
      return null;
    }
  }
  
  return null;
}

/**
 * Normalize a phone number.
 * Azerbaijani numbers → 994XXXXXXXXX
 * International numbers → +CCXXXXXXXXXX (E.164)
 *
 * @param {string|number} raw
 * @returns {string|null} normalized phone or null when invalid
 */
function normalizePhone(raw) {
  if (raw === null || raw === undefined) return null;
  const rawStr = String(raw).trim();
  if (!rawStr) return null;
  
  const digits = digitsOnly(rawStr);
  if (digits.length === 0) return null;

  // Try Azerbaijani normalization first
  if (isAzerbaijaniInput(rawStr)) {
    const az = normalizeAzerbaijani(digits);
    if (az) return az;
  }

  // Try international normalization
  const intl = normalizeInternational(digits, rawStr);
  if (intl) return intl;

  // Last resort: if it starts with + and has 7-15 digits, accept as international
  if (rawStr.startsWith('+') && digits.length >= 7 && digits.length <= 15) {
    return '+' + digits;
  }

  // Try as AZ one more time (e.g., 0501234567 without any +)
  const azFallback = normalizeAzerbaijani(digits);
  if (azFallback) return azFallback;

  return null;
}

/**
 * Validate a (preferably normalized) number.
 * For AZ: checks against known mobile prefixes.
 * For international: basic length/format check.
 * @param {string|number} raw
 * @returns {boolean}
 */
function isValidAzerbaijanMobile(raw) {
  const digits = digitsOnly(raw);

  if (digits.length === INTERNATIONAL_LENGTH && digits.startsWith(COUNTRY_CODE)) {
    return MOBILE_PREFIXES.includes(digits.slice(3, 5));
  }
  if (digits.length === LOCAL_LENGTH && digits.startsWith('0')) {
    return MOBILE_PREFIXES.includes(digits.slice(1, 3));
  }
  if (digits.length === 13 && digits.startsWith(COUNTRY_CODE + '0')) {
    return MOBILE_PREFIXES.includes(digits.slice(4, 6));
  }
  return false;
}

/**
 * Check if a normalized number is valid (AZ or international).
 */
function isValidPhone(normalized) {
  if (!normalized) return false;
  // AZ format
  if (normalized.startsWith('994') && normalized.length === INTERNATIONAL_LENGTH) {
    return isValidAzerbaijanMobile(normalized);
  }
  // International E.164
  if (normalized.startsWith('+') && normalized.length >= 8 && normalized.length <= 16) {
    return true;
  }
  return false;
}

/**
 * Pretty display format: +994 50 123 45 67 for AZ, or original for intl.
 * @param {string} normalized
 * @returns {string}
 */
function formatPhone(normalized) {
  const d = digitsOnly(normalized);
  if (d.length === INTERNATIONAL_LENGTH && d.startsWith(COUNTRY_CODE)) {
    return `+${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10, 12)}`;
  }
  // International — just add + prefix
  if (normalized.startsWith('+')) return normalized;
  return String(normalized || '');
}

/** Local representation with leading 0 for AZ numbers: 0501234567. */
function toLocal(normalized) {
  const d = digitsOnly(normalized);
  if (d.length === INTERNATIONAL_LENGTH && d.startsWith(COUNTRY_CODE)) {
    return '0' + d.slice(3);
  }
  return null;
}

/** List of valid mobile prefixes (without leading 0). */
function getMobilePrefixes() {
  return [...MOBILE_PREFIXES];
}

module.exports = {
  COUNTRY_CODE,
  MOBILE_PREFIXES,
  normalizePhone,
  isValidAzerbaijanMobile,
  isValidPhone,
  formatPhone,
  toLocal,
  getMobilePrefixes,
  isAzerbaijaniInput,
};
