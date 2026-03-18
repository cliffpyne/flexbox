import { Router } from 'express';
import { z } from 'zod';
import { sendOTP, verifyOTP } from '../otp';
import { generateTokens } from '../jwt';
import { redis } from '../redis';
import {
  getUserByPhone,
  createCustomer,
  updateLastLogin,
} from '../repos/users.repo';
import {
  storeRefreshToken,
} from '../repos/tokens.repo';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────
// POST /auth/otp/request
// Customer enters phone number → OTP sent via SMS
// ─────────────────────────────────────────────────────────────────────────
router.post('/request', async (req, res) => {
  try {
    const { phone } = z.object({
      phone: z.string().min(10),
    }).parse(req.body);

    await sendOTP(phone);

    // Always return success — do not reveal if phone exists or not (security)
    res.json({ success: true, message: 'OTP sent' });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /auth/otp/verify
// Customer submits OTP → get JWT tokens
// ─────────────────────────────────────────────────────────────────────────
router.post('/verify', async (req, res) => {
  try {
    const { phone, otp } = z.object({
      phone: z.string().min(10),
      otp: z.string().length(6),
    }).parse(req.body);

    const isValid = await verifyOTP(phone, otp, 'otp');
    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: 'AUTH_003: Invalid or expired OTP',
      });
    }

    // Find or create customer
    let user = await getUserByPhone(phone);

    if (!user) {
      // First login — auto-create customer account
      user = await createCustomer(phone);
    } else {
      // Existing user — must be a CUSTOMER (staff use password login)
      if (user.role !== 'CUSTOMER') {
        return res.status(403).json({
          success: false,
          message: 'AUTH_010: This account uses a different login method.',
        });
      }

      if (!user.is_active) {
        return res.status(403).json({
          success: false,
          message: 'AUTH_007: Account suspended. Contact support.',
        });
      }

      await updateLastLogin(user.user_id);
    }

    // Issue tokens
    const { accessToken, refreshToken, token_family } = generateTokens({
      user_id: user.user_id,
      role: user.role,
      office_id: user.office_id,
    });

    // Store refresh token in DB
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await storeRefreshToken({
      user_id: user.user_id,
      token: refreshToken,
      token_family,
      device_id: req.headers['x-device-id'] as string || 'unknown',
      parent_token_id: 'root',
      expires_at: expiresAt,
    });

    // Mark session active in Redis
    await redis.setEx(`session:active:${user.user_id}`, 900, '1');

    res.json({
      success: true,
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: {
          user_id: user.user_id,
          phone: user.phone,
          username: user.username,
          role: user.role,
        },
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

export default router;
