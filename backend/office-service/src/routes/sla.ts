import { Router }  from 'express';
import { z }       from 'zod';
import { db }      from '../db';
import { redis }   from '../redis';
import { authenticate, requireRole } from '../middleware';
import { handleSLACheck, pauseOfficeSLA, resumeOfficeSLA } from '../services/sla.service';
import { UserRole } from '@flexbox/types';

const router = Router({ mergeParams: true });

// ─────────────────────────────────────────────────────────────────────────────
// GET /offices/:id/sla/dashboard
// Live SLA status for all active parcels at this office
// ─────────────────────────────────────────────────────────────────────────────
router.get('/dashboard', authenticate, async (req: any, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         p.parcel_id, p.booking_reference,
         u.full_name as sender_name,
         sb.sla_type, sb.expected_by, sb.breached_at,
         EXTRACT(EPOCH FROM (NOW() - sb.breached_at))/60 as minutes_overdue,
         CASE WHEN sb.excused THEN 'EXCUSED' ELSE 'ACTIVE_BREACH' END as breach_status
       FROM sla_breaches sb
       JOIN parcels p ON p.parcel_id = sb.parcel_id
       JOIN app_users u ON u.user_id = p.sender_id
       WHERE sb.office_id = $1
         AND sb.resolved_at IS NULL
       ORDER BY sb.breached_at ASC`,
      [req.params.id]
    );

    // Check if SLAs are paused
    const paused = await redis.get(`sla:paused:${req.params.id}`);

    res.json({
      success: true,
      data: {
        office_id:  req.params.id,
        is_paused:  !!paused,
        pause_info: paused ? JSON.parse(paused) : null,
        active_breaches: rows,
        breach_count: rows.length,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /offices/:id/sla/check (QStash webhook — called by scheduled messages)
// This is what QStash calls when a timer fires
// ─────────────────────────────────────────────────────────────────────────────
router.post('/check', async (req: any, res) => {
  // Always return 200 — QStash retries on anything else
  try {
    const { parcel_id, sla_type, office_id, expected_by } = req.body;
    if (!parcel_id || !sla_type) {
      return res.status(200).json({ message: 'Invalid SLA check payload' });
    }

    const result = await handleSLACheck({ parcel_id, sla_type, office_id, expected_by });

    if (result.breached) {
      console.log(`[SLA BREACH] ${sla_type} for ${parcel_id} at office ${office_id}`);
      // Notification Service will pick up sla.breach from QStash
      // That event is published inside handleSLACheck
    }

    return res.status(200).json({ success: true, result });
  } catch (err: any) {
    console.error('[SLA check error]', err.message);
    return res.status(200).json({ message: 'SLA check error handled' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /offices/:id/sla/breaches
// History of all SLA breaches at this office
// ─────────────────────────────────────────────────────────────────────────────
router.get('/breaches',
  authenticate,
  requireRole(UserRole.OFFICE_MANAGER, UserRole.BRANCH_MANAGER, UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const { from, to, sla_type, excused } = req.query;

      const conditions: string[] = ['sb.office_id = $1'];
      const params: any[]        = [req.params.id];
      let i = 2;

      if (from)     { conditions.push(`sb.breached_at >= $${i++}`); params.push(from); }
      if (to)       { conditions.push(`sb.breached_at <= $${i++}`); params.push(to); }
      if (sla_type) { conditions.push(`sb.sla_type = $${i++}`);     params.push(sla_type); }
      if (excused !== undefined) {
        conditions.push(`sb.excused = $${i++}`);
        params.push(excused === 'true');
      }

      const { rows } = await db.query(
        `SELECT
           sb.*,
           p.booking_reference,
           u.full_name as sender_name,
           EXTRACT(EPOCH FROM COALESCE(sb.resolved_at, NOW()) - sb.breached_at)/60
             as breach_duration_mins
         FROM sla_breaches sb
         JOIN parcels p    ON p.parcel_id  = sb.parcel_id
         JOIN app_users u  ON u.user_id    = p.sender_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY sb.breached_at DESC
         LIMIT 100`,
        params
      );

      res.json({ success: true, data: rows, count: rows.length });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /offices/:id/sla/excuse
// Mark a breach as excused — valid reason given (power cut, emergency etc)
// Does NOT count against office performance metrics
// ─────────────────────────────────────────────────────────────────────────────
router.post('/excuse',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const { breach_id, reason } = z.object({
        breach_id: z.string().uuid(),
        reason:    z.string().min(10),
      }).parse(req.body);

      await db.query(
        `UPDATE sla_breaches
         SET excused = true, excuse_reason = $1, excused_by = $2, excuse_at = NOW()
         WHERE breach_id = $3 AND office_id = $4`,
        [reason, req.actor.user_id, breach_id, req.params.id]
      );

      res.json({ success: true, message: 'Breach marked as excused. Will not affect metrics.' });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /offices/:id/sla/pause
// Emergency pause — all SLA timers suspended for this office
// ─────────────────────────────────────────────────────────────────────────────
router.post('/pause',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const { reason } = z.object({ reason: z.string().min(10) }).parse(req.body);

      await pauseOfficeSLA(req.params.id, reason, req.actor.user_id);

      res.json({
        success: true,
        message: 'SLA timers paused for this office. No breaches will be recorded while paused.',
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /offices/:id/sla/resume
// Resume SLA timers after emergency
// ─────────────────────────────────────────────────────────────────────────────
router.post('/resume',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      await resumeOfficeSLA(req.params.id, req.actor.user_id);
      res.json({ success: true, message: 'SLA timers resumed.' });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /offices/:id/sla/config
// Get SLA timer windows for this office
// ─────────────────────────────────────────────────────────────────────────────
router.get('/config', authenticate, async (req: any, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM office_sla_config WHERE office_id = $1 ORDER BY sla_type`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /offices/:id/sla/config
// Update SLA window for a specific stage at this office
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/config',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const { sla_type, duration_minutes } = z.object({
        sla_type:         z.string(),
        duration_minutes: z.number().positive(),
      }).parse(req.body);

      await db.query(
        `INSERT INTO office_sla_config (office_id, sla_type, duration_minutes)
         VALUES ($1, $2, $3)
         ON CONFLICT (office_id, sla_type)
         DO UPDATE SET duration_minutes = $3, updated_at = NOW()`,
        [req.params.id, sla_type, duration_minutes]
      );

      res.json({
        success: true,
        message: `${sla_type} SLA updated to ${duration_minutes} minutes for this office.`,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

export default router;
