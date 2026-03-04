import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { redis } from '../redis';
import { generateTokens } from '../jwt';
import { db } from '../db';

const router = Router();

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECS = 15 * 60; // 15 minutes

// POST /auth/pin/login
router.post('/login', async (req, res) => {
  try {
    const { phone, pin } = z.object({
      phone: z.string().min(10),
      pin:   z.string().length(4),
    }).parse(req.body);

    const { rows: [user] } = await db.query(
      'SELECT * FROM app_users WHERE phone=$1',
      [phone]
    );

    if (!user) {
      return res.status(401).json({ success: false, message: 'AUTH_006: Invalid PIN' });
    }

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'AUTH_007: Account suspended' });
    }

    // Check lockout
    const lockKey = `pin_attempts:${user.user_id}`;
    const attempts = parseInt(await redis.get(lockKey) || '0');
    if (attempts >= MAX_ATTEMPTS) {
      return res.status(403).json({
        success: false,
        message: 'Account locked — contact your manager to unlock'
      });
    }

    // Verify PIN
    const isValid = await bcrypt.compare(pin, user.pin_hash || '');
    if (!isValid) {
      await redis.incr(lockKey);
      await redis.expire(lockKey, LOCKOUT_SECS);
      const remaining = MAX_ATTEMPTS - (attempts + 1);
      return res.status(401).json({
        success: false,
        message: `AUTH_006: Invalid PIN. ${remaining} attempts remaining`
      });
    }

    // Success — clear failed attempts
    await redis.del(lockKey);
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
