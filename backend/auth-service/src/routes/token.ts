import { Router }     from 'express';
import { z }          from 'zod';
import { generateTokens, verifyToken } from '../jwt';
import { redis }      from '../redis';
import { authenticate } from '../middleware';
import { getUserById } from '../repos/users.repo';
import {
  findRefreshToken,
  storeRefreshToken,
  revokeToken,
  revokeFamilyTokens,
  revokeAllUserTokens,
  isFamilyRevoked,
} from '../repos/tokens.repo';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────
// POST /auth/refresh
// Exchange a valid refresh token for a new access token + new refresh token
// This is TOKEN ROTATION — old refresh token is revoked, new one issued
// ─────────────────────────────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  try {
    const { refresh_token } = z.object({
      refresh_token: z.string().min(10),
    }).parse(req.body);

    // Step 1: Verify JWT signature and expiry
    let decoded: any;
    try {
      decoded = verifyToken(refresh_token);
    } catch {
      return res.status(401).json({
        success: false, message: 'Invalid or expired refresh token.',
      });
    }

    const { user_id, token_family } = decoded;

    // Step 2: Check if this family has been revoked (reuse attack detection)
    // If someone already used a refresh token from this family and it was rotated,
    // then someone is trying to reuse an old token — REVOKE EVERYTHING
    if (await isFamilyRevoked(token_family)) {
      await revokeAllUserTokens(user_id);
      await redis.setEx(`session:active:${user_id}`, 900, '0');
      return res.status(401).json({
        success: false,
        message: 'AUTH_011: Security violation detected. All sessions revoked. Please log in again.',
      });
    }

    // Step 3: Find the exact token in DB and verify hash
    const storedToken = await findRefreshToken(user_id, refresh_token);
    if (!storedToken) {
      return res.status(401).json({
        success: false, message: 'Refresh token not found or already revoked.',
      });
    }

    // Step 4: Get user
    const user = await getUserById(user_id);
    if (!user || !user.is_active) {
      return res.status(401).json({
        success: false, message: 'User not found or suspended.',
      });
    }

    // Step 5: Revoke the used refresh token (rotation)
    await revokeToken(storedToken.token_id);

    // Step 6: Issue new token pair
    const { accessToken, refreshToken: newRefreshToken, family: newFamily } =
      generateTokens({
        user_id:   user.user_id,
        role:      user.role,
        office_id: user.office_id,
      });

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await storeRefreshToken({
      user_id:      user.user_id,
      token:        newRefreshToken,
      token_family: newFamily,
      expires_at:   expiresAt,
    });

    await redis.setEx(`session:active:${user.user_id}`, 900, '1');

    res.json({
      success: true,
      data: {
        access_token:  accessToken,
        refresh_token: newRefreshToken,
      },
    });
  } catch (err: any) {
    res.status(401).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /auth/logout
// Revoke all tokens for this user — logout from all devices
// ─────────────────────────────────────────────────────────────────────────
router.post('/logout', authenticate, async (req: any, res) => {
  try {
    await revokeAllUserTokens(req.actor.user_id);
    await redis.setEx(`session:active:${req.actor.user_id}`, 900, '0');

    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /auth/me
// Get current logged-in user profile
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
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /auth/public-key
// Returns the RS256 public key so other services can verify JWTs
// ─────────────────────────────────────────────────────────────────────────
router.get('/public-key', (req, res) => {
  const { PUBLIC_KEY } = require('../jwt');
  res.json({ success: true, data: { public_key: PUBLIC_KEY } });
});

export default router;
