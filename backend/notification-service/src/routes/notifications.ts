import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { authenticate } from '../middleware';
import { sendPush, sendSMS } from '../channels';

const router = Router();

// ================================================================
// GET /notifications/history/:userId
// ================================================================
router.get('/history/:userId', authenticate, async (req: any, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;

    // CUSTOMER can only see own history
    if (req.actor.role === 'CUSTOMER' && req.actor.user_id !== userId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { rows } = await db.query(
      `SELECT notification_id, parcel_id, channel, template_key, message,
              status, sent_at, delivered_at, failed_at, created_at
       FROM notification_log
       WHERE recipient_id=$1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    res.json({ success: true, data: rows, page, limit });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
// POST /notifications/test — dev/staging only
// ================================================================
router.post('/test', authenticate, async (req: any, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ success: false, message: 'Test endpoint disabled in production' });
  }
  if (!['OPS_ADMIN', 'SUPER_ADMIN'].includes(req.actor.role)) {
    return res.status(403).json({ success: false, message: 'Ops Admin only' });
  }

  try {
    const body = z.object({
      recipient_phone: z.string(),
      channel: z.enum(['PUSH', 'SMS']),
      message: z.string(),
      fcm_token: z.string().optional(),
    }).parse(req.body);

    if (body.channel === 'SMS') {
      const result = await sendSMS(body.recipient_phone, body.message);
      return res.json({ success: result.success, result });
    }

    if (body.channel === 'PUSH' && body.fcm_token) {
      const result = await sendPush(body.fcm_token, 'FlexSend Test', body.message);
      return res.json({ success: result.success, result });
    }

    res.status(400).json({ success: false, message: 'FCM token required for push test' });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

export default router;