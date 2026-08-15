/**
 * Rate limiting — fixed-window in-memory limiter keyed by IP + route.
 */
const { makeLogger } = require('./logger');

const LOG = makeLogger('RATE-LIMIT');

class RateLimiter {
  constructor({ windowMs = 60000, max = 120 } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.buckets = new Map();
  }

  middleware(opts = {}) {
    const windowMs = opts.windowMs || this.windowMs;
    const max = opts.max || this.max;
    return (req, res, next) => {
      const key = `${req.ip || 'ip'}:${req.path}`;
      const now = Date.now();
      let bucket = this.buckets.get(key);
      if (!bucket || now - bucket.resetAt > windowMs) {
        bucket = { count: 0, resetAt: now + windowMs };
        this.buckets.set(key, bucket);
      }
      bucket.count++;
      if (bucket.count > max) {
        res.set('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
        return res.status(429).json({ error: 'Çox tez-tez sorğu göndərilir. Bir az gözləyin.' });
      }
      next();
    };
  }

  clear() {
    this.buckets.clear();
  }
}

module.exports = RateLimiter;
