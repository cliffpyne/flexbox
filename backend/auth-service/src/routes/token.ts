import { Router } from 'express';
import { verifyToken, generateTokens } from '../jwt';
import { db } from '../db';

const router = Router();

// POST /auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      return res.status(401).json({ success: false, message: 'No refresh token' });
    }

    const decoded = verifyToken(refresh_token);
    const { rows: [user] } = await db.query(
      'SELECT * FROM app_users WHERE user_id=$1 AND is_active=true',
      [decoded.user_id]
    );

    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    const tokens = generateTokens({
      user_id:   user.user_id,
      role:      user.role,
      office_id: user.office_id,
    });

    res.json({ success: true, data: tokens });
  } catch (err: any) {
    res.status(401).json({ success: false, message: 'Invalid refresh token' });
  }
});

// GET /auth/me
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, message: 'No token' });

    const decoded = verifyToken(token);
    const { rows: [user] } = await db.query(
      'SELECT user_id, phone, full_name, role, is_active, photo_url FROM app_users WHERE user_id=$1',
      [decoded.user_id]
    );

    res.json({ success: true, data: user });
  } catch (err: any) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
});

export default router;
