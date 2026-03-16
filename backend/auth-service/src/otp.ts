import bcrypt from 'bcrypt';
import AfricasTalking from 'africastalking';
import { redis } from './redis';
import { db } from './db';
import { OTP } from '@flexbox/constants';
import 'dotenv/config';

// ← REPLACE AT_API_KEY AND AT_USERNAME IN .env
const AT = AfricasTalking({
  apiKey:   process.env.AT_API_KEY   || 'REPLACE_AT_API_KEY',
  username: process.env.AT_USERNAME  || 'REPLACE_AT_USERNAME',
});

function generateOTP(): string {
  return Array.from({ length: OTP.LENGTH }, () =>
    Math.floor(Math.random() * 10)
  ).join('');
}

export async function sendOTP(phone: string): Promise<void> {
  // Rate limit — max 3 OTPs per phone per hour
  const rateLimitKey = `otp_rate:${phone}`;
  const attempts = await redis.incr(rateLimitKey);
  if (attempts === 1) await redis.expire(rateLimitKey, 3600);
  if (attempts > OTP.RATE_LIMIT) {
    throw new Error('Too many OTP requests. Try again in an hour.');
  }

  const otp = generateOTP();
  const hash = await bcrypt.hash(otp, 10);
  const redisKey = `otp:${phone}`;

  // Store in Redis — fast validation
  await redis.setEx(redisKey, OTP.EXPIRY_SECS, hash);

  // Store in PostgreSQL — audit trail only
  await db.query(
    `INSERT INTO otp_requests (phone, otp_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '10 minutes')`,
    [phone, hash]
  );

  // Send SMS or log to console in development
  if (process.env.NODE_ENV === 'development') {
    console.log(`OTP for ${phone}: ${otp}`); // ← OTP logged here in dev
  } else {
    await AT.SMS.send({
      to:      [phone],
      message: `Your FlexSend code is: ${otp}. Valid for 10 minutes.`,
      from:    'FlexSend',
    });
  }
}

export async function verifyOTP(
  phone: string,
  otp: string,
  redisPrefix: 'otp' | 'pwd_reset' = 'otp'
): Promise<boolean> {
  const redisKey = `${redisPrefix}:${phone}`;
  const hash = await redis.get(redisKey);
  if (!hash) return false;
  const isValid = await bcrypt.compare(otp, hash);
  if (isValid) {
    // Single use — delete immediately on first use
    await redis.del(redisKey);
  }
  return isValid;
}

export async function sendForgotPasswordOTP(phone: string): Promise<void> {
  const rateKey = `pwd_reset_rate:${phone}`;
  const count   = await redis.incr(rateKey);
  if (count === 1) await redis.expire(rateKey, 3600);
  if (count > 3) {
    throw new Error('Too many reset requests. Try again in an hour.');
  }

  const otp  = String(Math.floor(100000 + Math.random() * 900000));
  const hash = await bcrypt.hash(otp, 10);

  await redis.setEx(
    `pwd_reset:${phone}`,
    600,
    hash
  );

  if (process.env.NODE_ENV === 'development') {
    console.log(`[FORGOT PASSWORD OTP] ${phone}: ${otp}`);
    return;
  }

  await AT.SMS.send({
    to:      [phone],
    message: `FlexSend password reset code: ${otp}. Valid for 10 minutes. If you did not request this, ignore.`,
    from:    'FlexSend',
  });
}
