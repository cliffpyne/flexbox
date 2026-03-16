import { Router } from 'express';
import { z }      from 'zod';
import { authenticate } from '../middleware';
import { validateUsername, } from '../lib/username';
import { updateUsername } from '../repos/users.repo';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────
// PATCH /auth/username
// Any logged-in user can change their own username
// Rules: unique, not a phone number, 3–20 chars
// ─────────────────────────────────────────────────────────────────────────
router.patch('/', authenticate, async (req: any, res) => {
  try {
    const { username } = z.object({
      username: z.string().min(3).max(20),
    }).parse(req.body);

    const error = await validateUsername(username, req.actor.user_id);
    if (error) {
      return res.status(400).json({ success: false, message: error });
    }

    await updateUsername(req.actor.user_id, username);

    res.json({
      success: true,
      message: 'Username updated.',
      data: { username },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

export default router;
