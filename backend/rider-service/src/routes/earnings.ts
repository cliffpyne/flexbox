import { Router, Response } from 'express';
import { db } from '../db';
import { authenticate } from '../middleware';

const router = Router();

// ── GET /riders/:id/earnings/summary — Fast dashboard read ───────────────────
router.get('/:id/earnings/summary', authenticate, async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const isOwn     = req.actor.user_id === id;
    const isManager = ['OFFICE_MANAGER','OPS_ADMIN'].includes(req.actor.role);
    if (!isOwn && !isManager) return res.status(403).json({ success: false, message: 'Access denied' });

    // Single fast read from denormalised summary table
    const result = await db.query(
      `SELECT today_pending, today_confirmed, week_total, month_total, lifetime_total, last_updated
       FROM rider_earnings_summary WHERE rider_id = $1`,
      [id]
    );

    if (!result.rows[0]) {
      // Return zeros if no summary yet
      return res.json({
        success: true,
        data: {
          today_pending:   0,
          today_confirmed: 0,
          week_total:      0,
          month_total:     0,
          lifetime_total:  0,
          last_updated:    null,
        },
      });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /riders/:id/earnings — Full earnings history ────────────────────────
router.get('/:id/earnings', authenticate, async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const isOwn     = req.actor.user_id === id;
    const isManager = ['OFFICE_MANAGER','OPS_ADMIN'].includes(req.actor.role);
    if (!isOwn && !isManager) return res.status(403).json({ success: false, message: 'Access denied' });

    const { from, to, status, page = '1', limit = '20' } = req.query as any;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const conditions = ['rj.rider_id = $1', "rj.status = 'COMPLETED'"];
    const params: any[] = [id];
    let pi = 2;

    if (from)   { conditions.push(`rj.completed_at >= $${pi++}`); params.push(from); }
    if (to)     { conditions.push(`rj.completed_at <= $${pi++}`); params.push(to); }
    if (status) { conditions.push(`rj.earning_status = $${pi++}`); params.push(status); }

    const result = await db.query(
      `SELECT
         rj.job_id, rj.job_type, rj.earning_amount, rj.earning_status,
         rj.completed_at, rj.was_on_time, rj.actual_duration_mins,
         p.booking_reference, p.item_category
       FROM rider_jobs rj
       JOIN parcels p ON p.parcel_id = rj.parcel_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY rj.completed_at DESC
       LIMIT $${pi++} OFFSET $${pi++}`,
      [...params, parseInt(limit), offset]
    );

    // Summary totals
    const totals = await db.query(
      `SELECT
         COALESCE(SUM(earning_amount) FILTER (WHERE earning_status = 'PENDING'),   0) AS pending_total,
         COALESCE(SUM(earning_amount) FILTER (WHERE earning_status = 'CONFIRMED'),  0) AS confirmed_total,
         COALESCE(SUM(earning_amount) FILTER (WHERE earning_status = 'PAID'),       0) AS paid_total,
         COUNT(*) AS total_jobs
       FROM rider_jobs WHERE rider_id = $1 AND status = 'COMPLETED'`,
      [id]
    );

    res.json({
      success: true,
      data: {
        jobs:    result.rows,
        summary: totals.rows[0],
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;