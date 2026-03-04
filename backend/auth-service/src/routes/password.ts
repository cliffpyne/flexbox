import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import speakeasy from 'speakeasy';
import { generateTokens } from '../jwt';
import { db } from '../db';
import { UserRole } from '@flexbox/types';

const router = Router();

// POST /auth/password/login
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = z.object({
      phone:    z.string().min(10),
      password: z.string().min(8),
    }).parse(req.body);

    const { rows: [user] } = await db.query(
      'SELECT * FROM app_users WHERE phone=$1',
      [phone]
    );

    if (!user || !user.password_hash) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'AUTH_007: Account suspended' });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // OPS_ADMIN and SUPER_ADMIN require TOTP second step
    if ([UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN].includes(user.role)) {
      return res.json({
        success: true,
        requires_totp: true,
        totp_session: Buffer.from(user.user_id).toString('base64'),
      });
    }

    await db.query(
      'UPDATE app_users SET last_login_at=NOW() WHERE user_id=$1',
      [user.user_id]
    );

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

// POST /auth/totp/verify — for OPS_ADMIN and SUPER_ADMIN
router.post('/totp/verify', async (req, res) => {
  try {
    const { totp_session, totp_code } = z.object({
      totp_session: z.string(),
      totp_code:    z.string().length(6),
    }).parse(req.body);

    const user_id = Buffer.from(totp_session, 'base64').toString();
    const { rows: [user] } = await db.query(
      'SELECT * FROM app_users WHERE user_id=$1',
      [user_id]
    );

    if (!user || !user.totp_secret) {
      return res.status(401).json({ success: false, message: 'Invalid session' });
    }

    const isValid = speakeasy.totp.verify({
      secret:   user.totp_secret,
      encoding: 'base32',
      token:    totp_code,
      window:   1,
    });

    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid TOTP code' });
    }

    await db.query(
      'UPDATE app_users SET last_login_at=NOW() WHERE user_id=$1',
      [user.user_id]
    );

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
