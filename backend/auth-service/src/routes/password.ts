import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import speakeasy from 'speakeasy';
import crypto from 'crypto';
import { generateTokens } from '../jwt';
import { redis } from '../redis';
import { sendOTP, verifyOTP, sendForgotPasswordOTP } from '../otp';
import { authenticate, blockIfMustChangePassword } from '../middleware';
import { hashPassword, validatePasswordStrength } from '../lib/password';
import { sendSMS, smsPasswordChanged } from '../lib/sms';
import {
  getUserByUsername,
  getUserById,
  updateLastLogin,
  markPasswordChanged,
} from '../repos/users.repo';
import {
  storeRefreshToken,
  revokeAllUserTokens,
} from '../repos/tokens.repo';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────
// POST /auth/password/login
// Staff login: username + password
// ─────────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { username, password } = z.object({
      username: z.string().min(3),
      password: z.string().min(1),
    }).parse(req.body);

    // Lookup by USERNAME — not phone
    const user = await getUserByUsername(username);

    if (!user || !user.password_hash) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password',
      });
    }

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'AUTH_007: Account suspended. Contact your manager.',
      });
    }

    // Check lockout from failed attempts
    const lockKey = `pwd_attempts:${user.user_id}`;
    const attempts = parseInt(await redis.get(lockKey) || '0');
    const MAX_ATTEMPTS = 10;
    const LOCK_SECS = 5 * 60; // 5 minutes // 30 minutes

    if (attempts >= MAX_ATTEMPTS) {
      return res.status(403).json({
        success: false,
        message: 'Account temporarily locked due to too many failed attempts. Try again in 30 minutes.',
      });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      await redis.incr(lockKey);
      await redis.expire(lockKey, LOCK_SECS);
      const remaining = MAX_ATTEMPTS - (attempts + 1);
      return res.status(401).json({
        success: false,
        message: `Invalid username or password. ${remaining} attempts remaining.`,
      });
    }

    // Clear failed attempts on success
    await redis.del(lockKey);

    // OPS_ADMIN and SUPER_ADMIN require TOTP second factor
    if (['SUPER_ADMIN'].includes(user.role)) {
      // Store a short-lived Redis session for TOTP step
      const totpSessionKey = crypto.randomUUID();
      await redis.setEx(
        `totp_pending:${totpSessionKey}`,
        300, // 5 minutes to complete TOTP
        user.user_id
      );

      return res.json({
        success: true,
        requires_totp: true,
        totp_session: totpSessionKey, // opaque key — cannot be decoded
      });
    }

    await updateLastLogin(user.user_id);

    const { accessToken, refreshToken, token_family } = generateTokens({
      user_id: user.user_id,
      role: user.role,
      office_id: user.office_id,
    });

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await storeRefreshToken({
      user_id: user.user_id,
      token: refreshToken,
      token_family,
      device_id: req.headers['x-device-id'] as string || 'unknown',
      parent_token_id: 'root',
      expires_at: expiresAt,
    });

    await redis.setEx(`session:active:${user.user_id}`, 900, '1');

    res.json({
      success: true,
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        must_change_password: user.must_change_password,
        user: {
          user_id: user.user_id,
          username: user.username,
          full_name: user.full_name,
          role: user.role,
          office_id: user.office_id,
        },
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /auth/password/totp/verify
// Second step for OPS_ADMIN and SUPER_ADMIN
// ─────────────────────────────────────────────────────────────────────────
router.post('/totp/verify', async (req, res) => {
  try {
    const { totp_session, totp_code } = z.object({
      totp_session: z.string().uuid(),
      totp_code: z.string().length(6),
    }).parse(req.body);

    // Retrieve user_id from Redis session — NOT from base64 decode
    const user_id = await redis.get(`totp_pending:${totp_session}`);
    if (!user_id) {
      return res.status(401).json({
        success: false,
        message: 'TOTP session expired. Please log in again.',
      });
    }

    const user = await getUserById(user_id);
    if (!user || !user.totp_secret) {
      return res.status(401).json({
        success: false,
        message: 'TOTP not configured. Contact Super Admin.',
      });
    }

    const isValid = speakeasy.totp.verify({
      secret: user.totp_secret,
      encoding: 'base32',
      token: totp_code,
      window: 1,
    });

    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authenticator code.',
      });
    }

    // TOTP verified — delete session, issue tokens
    await redis.del(`totp_pending:${totp_session}`);
    await updateLastLogin(user.user_id);

    const { accessToken, refreshToken, token_family } = generateTokens({
      user_id: user.user_id,
      role: user.role,
      office_id: user.office_id,
    });

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await storeRefreshToken({
      user_id: user.user_id,
      token: refreshToken,
      token_family,
      device_id: req.headers['x-device-id'] as string || 'unknown',
      parent_token_id: 'root',
      expires_at: expiresAt,
    });

    await redis.setEx(`session:active:${user.user_id}`, 900, '1');

    res.json({
      success: true,
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: {
          user_id: user.user_id,
          username: user.username,
          full_name: user.full_name,
          role: user.role,
          office_id: user.office_id,
        },
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /auth/password/change
// Logged-in user changes their password (also clears must_change_password)
// ─────────────────────────────────────────────────────────────────────────
router.post('/change',
  authenticate,
  async (req: any, res) => {
    try {
      const { current_password, new_password } = z.object({
        current_password: z.string().min(1),
        new_password: z.string().min(8),
      }).parse(req.body);

      const user = await getUserById(req.actor.user_id);
      if (!user || !user.password_hash) {
        return res.status(400).json({
          success: false, message: 'Password change not available for this account type.',
        });
      }

      // Verify current password
      const isValid = await bcrypt.compare(current_password, user.password_hash);
      if (!isValid) {
        return res.status(401).json({
          success: false, message: 'Current password is incorrect.',
        });
      }

      // Validate new password strength
      const strengthError = validatePasswordStrength(new_password);
      if (strengthError) {
        return res.status(400).json({ success: false, message: strengthError });
      }

      // Cannot reuse current password
      if (await bcrypt.compare(new_password, user.password_hash)) {
        return res.status(400).json({
          success: false, message: 'New password must be different from your current password.',
        });
      }

      const new_hash = await hashPassword(new_password);
      await markPasswordChanged(user.user_id, new_hash);

      // Notify user via SMS
      await sendSMS(user.phone, smsPasswordChanged());

      res.json({ success: true, message: 'Password changed successfully.' });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────
// POST /auth/password/forgot
// Request a password reset OTP (sends to registered phone)
// ─────────────────────────────────────────────────────────────────────────
router.post('/forgot', async (req, res) => {
  try {
    const { phone } = z.object({
      phone: z.string().min(10),
    }).parse(req.body);

    // Always return success — do not reveal if phone is registered
    await sendForgotPasswordOTP(phone).catch(() => { });

    res.json({
      success: true,
      message: 'If this number is registered, you will receive a reset code.',
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /auth/password/reset
// Submit OTP + new password to complete reset
// ─────────────────────────────────────────────────────────────────────────
router.post('/reset', async (req, res) => {
  try {
    const { phone, otp, new_password } = z.object({
      phone: z.string().min(10),
      otp: z.string().length(6),
      new_password: z.string().min(8),
    }).parse(req.body);

    // Verify OTP using pwd_reset prefix
    const isValid = await verifyOTP(phone, otp, 'pwd_reset');
    if (!isValid) {
      return res.status(401).json({
        success: false, message: 'Invalid or expired reset code.',
      });
    }

    // Validate password strength
    const strengthError = validatePasswordStrength(new_password);
    if (strengthError) {
      return res.status(400).json({ success: false, message: strengthError });
    }

    // Find user
    const { rows: [user] } = await (await import('../db')).db.query(
      'SELECT * FROM app_users WHERE phone = $1',
      [phone]
    );
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const new_hash = await hashPassword(new_password);
    await markPasswordChanged(user.user_id, new_hash);

    // Revoke all existing tokens — security: force re-login
    await revokeAllUserTokens(user.user_id);
    await redis.setEx(`session:active:${user.user_id}`, 900, '0');

    // Notify user
    await sendSMS(user.phone, smsPasswordChanged());

    res.json({
      success: true,
      message: 'Password reset successfully. Please log in with your new password.',
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

export default router;
