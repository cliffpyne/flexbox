import { Router }   from 'express';
import { z }        from 'zod';
import bcrypt       from 'bcrypt';
import { redis }    from '../redis';
import { generateTokens }  from '../jwt';
import { getUserByPhone }  from '../repos/users.repo';
import { storeRefreshToken } from '../repos/tokens.repo';

const router = Router();

const MAX_ATTEMPTS  = 5;
const LOCKOUT_SECS  = 15 * 60; // 15 minutes

// ─────────────────────────────────────────────────────────────────────────
// POST /auth/pin/login
// Used by: RIDER, OFFICE_WORKER
// They log in with their phone number + 4-digit PIN
// ─────────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { phone, pin } = z.object({
      phone: z.string().min(10),
      pin:   z.string().length(4),
    }).parse(req.body);

    // Find user by phone
    const user = await getUserByPhone(phone);

    if (!user || !user.pin_hash) {
      return res.status(401).json({
        success: false,
        message: 'AUTH_006: Invalid phone or PIN',
      });
    }

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'AUTH_007: Account suspended. Contact your manager.',
      });
    }

    // Check lockout
    const lockKey  = `pin_attempts:${user.user_id}`;
    const attempts = parseInt(await redis.get(lockKey) || '0');

    if (attempts >= MAX_ATTEMPTS) {
      return res.status(403).json({
        success: false,
        message: 'Account locked. Contact your manager to unlock.',
      });
    }

    // Verify PIN
    const isValid = await bcrypt.compare(pin, user.pin_hash);

    if (!isValid) {
      await redis.incr(lockKey);
      await redis.expire(lockKey, LOCKOUT_SECS);
      const remaining = MAX_ATTEMPTS - (attempts + 1);
      return res.status(401).json({
        success: false,
        message: `AUTH_006: Invalid PIN. ${remaining} attempts remaining.`,
      });
    }

    // Success — clear failed attempts
    await redis.del(lockKey);

    // Issue tokens
    const { accessToken, refreshToken, token_family } = generateTokens({
      user_id:   user.user_id,
      role:      user.role,
      office_id: user.office_id,
    });

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
await storeRefreshToken({
  user_id:         user.user_id,
  token:           refreshToken,
  token_family,
  device_id:       req.headers['x-device-id'] as string || 'unknown',
  parent_token_id: 'root',
  expires_at:      expiresAt,
});

    await redis.setEx(`session:active:${user.user_id}`, 900, '1');

    // Update last login
    await redis.set(`last_login:${user.user_id}`, new Date().toISOString());

    res.json({
      success: true,
      data: {
        access_token:  accessToken,
        refresh_token: refreshToken,
        user: {
          user_id:   user.user_id,
          phone:     user.phone,
          full_name: user.full_name,
          role:      user.role,
          office_id: user.office_id,
        },
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

export default router;