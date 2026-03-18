import { Router }     from 'express';
import { z }          from 'zod';
import { generateTokens, verifyToken } from '../jwt';
import { redis }      from '../redis';
import { authenticate } from '../middleware';
import { getUserById }  from '../repos/users.repo';
import {
  findRefreshToken,
  storeRefreshToken,
  revokeToken,
  revokeFamilyTokens,
  revokeAllUserTokens,
  revokeDeviceTokens,
  isFamilyRevoked,
  getActiveSessions,
  getTokenChain,
} from '../repos/tokens.repo';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────
// POST /auth/refresh
// ─────────────────────────────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  try {
    const { refresh_token } = z.object({
      refresh_token: z.string().min(10),
    }).parse(req.body);

    // 1. Verify JWT
    let decoded: any;
    try {
      decoded = verifyToken(refresh_token);
    } catch {
      return res.status(401).json({
        success: false, message: 'AUTH_010: Invalid or expired refresh token',
      });
    }

    const { user_id, token_family, device_id, parent_token_id } = decoded;

    // 2. Reuse attack: family already revoked
    if (await isFamilyRevoked(token_family)) {
      await revokeAllUserTokens(user_id);
      await redis.set(`session:active:${user_id}`, '0');
      return res.status(401).json({
        success: false, message: 'AUTH_011: Session compromised. Please login again.',
      });
    }

    // 3. Find token in DB
    const storedToken = await findRefreshToken(user_id, refresh_token);
    if (!storedToken) {
      // Reuse attack detected
      await revokeFamilyTokens(token_family);
      await revokeAllUserTokens(user_id);
      await redis.set(`session:active:${user_id}`, '0');
      return res.status(401).json({
        success: false, message: 'AUTH_012: Token reuse detected. Session terminated.',
      });
    }

    // 4. Validate user
    const user = await getUserById(user_id);
    if (!user || !user.is_active) {
      return res.status(401).json({
        success: false, message: 'AUTH_013: User inactive or not found',
      });
    }

    // 5. Rotate — revoke old, issue new (SAME family, parent = old token_id)
    await revokeToken(storedToken.token_id);

    const { accessToken, refreshToken: newRefreshToken } = generateTokens({
      user_id:          user.user_id,
      role:             user.role,
      office_id:        user.office_id,
      device_id:        device_id || storedToken.device_id || 'unknown',
      token_family,                           // SAME family — keeps chain intact
      parent_token_id:  storedToken.token_id, // current token becomes parent
    });

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await storeRefreshToken({
      user_id,
      token:            newRefreshToken,
      token_family,
      device_id:        device_id || storedToken.device_id || 'unknown',
      parent_token_id:  storedToken.token_id,
      expires_at:       expiresAt,
    });

    await redis.set(`session:active:${user.user_id}`, '1');

    return res.json({
      success: true,
      data: { access_token: accessToken, refresh_token: newRefreshToken },
    });
  } catch (err: any) {
    return res.status(401).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /auth/logout
// Logout current device only
// ─────────────────────────────────────────────────────────────────────────
router.post('/logout', authenticate, async (req: any, res) => {
  try {
    const device_id = req.actor?.device_id;

    if (device_id && device_id !== 'unknown') {
      // Logout this device only
      await revokeDeviceTokens(req.actor.user_id, device_id);
    } else {
      // Fallback — logout all
      await revokeAllUserTokens(req.actor.user_id);
    }

    await redis.setEx(`session:active:${req.actor.user_id}`, 900, '0');
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /auth/logout-all
// Logout from ALL devices
// ─────────────────────────────────────────────────────────────────────────
router.post('/logout-all', authenticate, async (req: any, res) => {
  try {
    await revokeAllUserTokens(req.actor.user_id);
    await redis.setEx(`session:active:${req.actor.user_id}`, 900, '0');
    res.json({ success: true, message: 'Logged out from all devices.' });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /auth/sessions
// View all active sessions (devices) for logged-in user
// ─────────────────────────────────────────────────────────────────────────
router.get('/sessions', authenticate, async (req: any, res) => {
  try {
    const sessions = await getActiveSessions(req.actor.user_id);
    res.json({ success: true, data: sessions });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /auth/sessions/:family/chain
// Forensic: view full token chain for a session (Ops Admin only)
// ─────────────────────────────────────────────────────────────────────────
router.get('/sessions/:family/chain', authenticate, async (req: any, res) => {
  try {
    const chain = await getTokenChain(req.params.family);
    res.json({ success: true, data: chain });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /auth/me
// ─────────────────────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req: any, res) => {
  try {
    const user = await getUserById(req.actor.user_id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    res.json({
      success: true,
      data: {
        user_id:              user.user_id,
        username:             user.username,
        phone:                user.phone,
        full_name:            user.full_name,
        role:                 user.role,
        office_id:            user.office_id,
        must_change_password: user.must_change_password,
        is_active:            user.is_active,
        last_login_at:        user.last_login_at,
        device_id:            req.actor.device_id,
        token_family:         req.actor.token_family,
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /auth/public-key
// ─────────────────────────────────────────────────────────────────────────
router.get('/public-key', (_req, res) => {
  const { PUBLIC_KEY } = require('../jwt');
  res.json({ success: true, data: { public_key: PUBLIC_KEY } });
});

export default router;
