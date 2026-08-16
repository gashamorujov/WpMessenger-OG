/**
 * Rate limiting — fixed-window in-memory limiter.
 * Works per serverless instance; sufficient to blunt brute-force attempts.
 */
const buckets = new Map();

function rateLimit(key, { windowMs = 60000, max = 120 } = {}) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.resetAt > windowMs) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count++;
  if (bucket.count > max) return { limited: true, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  return { limited: false };
}

function clientIp(request) {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

module.exports = { rateLimit, clientIp };
