import { Request, Response, NextFunction } from 'express';
import { redis } from '../redis';

interface RateLimitConfig {
  limit:  number;
  window: number; // seconds
  keyFn:  (req: any) => string;
}

export function rateLimiter(config: RateLimitConfig) {
  return async (req: any, res: Response, next: NextFunction) => {
    try {
      const key   = `ratelimit:${config.keyFn(req)}`;
      const count = await redis.incr(key);

      if (count === 1) {
        await redis.expire(key, config.window);
      }

      res.setHeader('X-RateLimit-Limit',     config.limit);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, config.limit - count));

      if (count > config.limit) {
        const ttl = await redis.ttl(key);
        res.setHeader('X-RateLimit-Reset', Date.now() + ttl * 1000);
        return res.status(429).json({
          success: false,
          error: {
            code:    'RATE_LIMIT_EXCEEDED',
            message: `Too many requests. Try again in ${ttl} seconds.`
          }
        });
      }

      next();
    } catch {
      // Redis down — degrade gracefully, never block requests
      console.warn('[gateway] Rate limiter Redis unavailable — allowing request');
      next();
    }
  };
}

// ── Pre-built rate limiters ───────────────────────────────────────────────────

export const otpRateLimit = rateLimiter({
  limit: 3, window: 3600,
  keyFn: (req) => `otp:${req.body?.phone || req.ip}`
});

export const publicTrackingRateLimit = rateLimiter({
  limit: 10, window: 60,
  keyFn: (req) => `track:${req.ip}`
});

export const publicKeyRateLimit = rateLimiter({
  limit: 5, window: 60,
  keyFn: (req) => `pubkey:${req.ip}`
});

export const standardRateLimit = rateLimiter({
  limit: 100, window: 60,
  keyFn: (req) => `std:${req.userId || req.ip}`
});

export const bookingRateLimit = rateLimiter({
  limit: 10, window: 60,
  keyFn: (req) => `booking:${req.userId}`
});

export const riderGpsRateLimit = rateLimiter({
  limit: 12, window: 60,
  keyFn: (req) => `rider_gps:${req.userId}`
});

export const authRateLimit = rateLimiter({
  limit: 20, window: 60,
  keyFn: (req) => `auth:${req.ip}`
});

export const officeRateLimit = rateLimiter({
  limit: 300, window: 60,
  keyFn: (req) => `office:${req.userId || req.ip}`
});

export const adminRateLimit = rateLimiter({
  limit: 500, window: 60,
  keyFn: (req) => `admin:${req.userId || req.ip}`
});