import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { sendOTP, verifyOTP } from '../otp';
import { generateTokens } from '../jwt';
import { db } from '../db';
import { UserRole } from '@flexbox/types';

const router = Router();

// POST /auth/otp/request
router.post('/request', async (req, res) => {
  try {
    const { phone } = z.object({
      phone: z.string().min(10)
    }).parse(req.body);

    await sendOTP(phone);
    res.json({ success: true, message: 'OTP sent' });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /auth/otp/verify
router.post('/verify', async (req, res) => {
  try {
    const { phone, otp } = z.object({
      phone: z.string().min(10),
      otp:   z.string().length(6),
    }).parse(req.body);

    const isValid = await verifyOTP(phone, otp);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'AUTH_003: Invalid or expired OTP' });
    }

    // Get or create user
    let { rows: [user] } = await db.query(
      'SELECT * FROM app_users WHERE phone = $1',
      [phone]
    );

    if (!user) {
      // Auto-create customer
      const { rows: [newUser] } = await db.query(
        `INSERT INTO app_users (phone, role, is_verified)
         VALUES ($1, $2, true) RETURNING *`,
        [phone, UserRole.CUSTOMER]
      );
      user = newUser;
    } else {
      // Mark verified
      await db.query(
        'UPDATE app_users SET is_verified=true, last_login_at=NOW() WHERE user_id=$1',
        [user.user_id]
      );
    }

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'AUTH_007: Account suspended' });
    }

    const tokens = generateTokens({
      user_id:   user.user_id,
      role:      user.role,
      office_id: user.office_id,
    });

    res.json({ success: true, data: { ...tokens, user } });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

export default router;
