import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { redis } from '../redis';
import { publishEvent } from '../qstash';
import { authenticate, requireRole, requireOwnOrManager } from '../middleware';

const router = Router();

// ── GET /riders — List riders at an office ───────────────────────────────────
router.get('/', authenticate, requireRole('OFFICE_MANAGER', 'OPS_ADMIN'), async (req: Request, res: Response) => {
  try {
    const { office_id, availability, status, page = '1', limit = '20' } = req.query as any;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const conditions: string[] = [];
    const params: any[] = [];
    let pi = 1;

    if (office_id)   { conditions.push(`r.home_office_id = $${pi++}`);  params.push(office_id); }
    if (availability){ conditions.push(`r.availability = $${pi++}`);    params.push(availability); }
    if (status)      { conditions.push(`r.status = $${pi++}`);          params.push(status); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.query(
      `SELECT
         r.rider_id, u.full_name, u.phone, r.vehicle_type,
         r.availability, r.status, r.home_office_id,
         r.on_time_rate, r.delivery_success_rate, r.total_jobs_completed,
         r.max_parcel_weight_kg, r.max_parcel_count, r.current_zone,
         (SELECT COUNT(*) FROM rider_jobs rj
          WHERE rj.rider_id = r.rider_id
          AND rj.status IN ('ASSIGNED','ACCEPTED','EN_ROUTE','ARRIVED')) AS active_job_count,
         COALESCE(res.today_confirmed, 0) AS today_earnings
       FROM riders r
       JOIN users u ON u.user_id = r.user_id
       LEFT JOIN rider_earnings_summary res ON res.rider_id = r.rider_id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT $${pi++} OFFSET $${pi++}`,
      [...params, parseInt(limit), offset]
    );

    res.json({ success: true, data: result.rows });
  } catch (err: any) {
    console.error('GET /riders error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to list riders' });
  }
});

// ── GET /riders/available — ML assignment candidate pool ─────────────────────
router.get('/available', authenticate, async (req: Request, res: Response) => {
  try {
    const { office_id, job_type } = req.query as any;
    if (!office_id) return res.status(400).json({ success: false, message: 'office_id required' });

    // Get all ONLINE ACTIVE riders at this office
    const result = await db.query(
      `SELECT
         r.rider_id, u.full_name AS name, r.vehicle_type,
         r.max_parcel_weight_kg, r.max_parcel_count,
         r.on_time_rate, r.delivery_success_rate, r.zone_familiarity_score,
         COALESCE(SUM(COALESCE(p.confirmed_weight_kg, p.declared_weight_kg * 1.2)), 0) AS current_weight_kg,
         COUNT(rj.job_id) AS current_job_count
       FROM riders r
       JOIN users u ON u.user_id = r.user_id
       LEFT JOIN rider_jobs rj ON rj.rider_id = r.rider_id
         AND rj.status IN ('ASSIGNED','ACCEPTED','EN_ROUTE','ARRIVED')
       LEFT JOIN parcels p ON p.parcel_id = rj.parcel_id
       WHERE r.home_office_id = $1
         AND r.availability IN ('ONLINE','ON_JOB')
         AND r.status = 'ACTIVE'
       GROUP BY r.rider_id, u.full_name, r.vehicle_type, r.max_parcel_weight_kg,
                r.max_parcel_count, r.on_time_rate, r.delivery_success_rate, r.zone_familiarity_score`,
      [office_id]
    );

    // Filter by capacity and enrich with Redis location
    const candidates = await Promise.all(
      result.rows.map(async (rider: any) => {
        const availableWeight = rider.max_parcel_weight_kg - parseFloat(rider.current_weight_kg);
        const availableCount  = rider.max_parcel_count - parseInt(rider.current_job_count);
        if (availableWeight <= 0 || availableCount <= 0) return null;

        // Get last known location from Redis
        let lastLocation = null;
        try {
          const locRaw = await redis.get(`rider:${rider.rider_id}:location`);
          if (locRaw) lastLocation = JSON.parse(locRaw);
        } catch {}

        return {
          rider_id:               rider.rider_id,
          name:                   rider.name,
          vehicle_type:           rider.vehicle_type,
          current_job_count:      parseInt(rider.current_job_count),
          current_weight_kg:      parseFloat(rider.current_weight_kg),
          available_weight_kg:    availableWeight,
          available_parcel_count: availableCount,
          on_time_rate:           parseFloat(rider.on_time_rate) || 1.0,
          delivery_success_rate:  parseFloat(rider.delivery_success_rate) || 1.0,
          zone_familiarity_score: parseFloat(rider.zone_familiarity_score) || 0.5,
          last_location:          lastLocation,
        };
      })
    );

    res.json({ success: true, data: { office_id, candidates: candidates.filter(Boolean) } });
  } catch (err: any) {
    console.error('GET /riders/available error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to get available riders' });
  }
});

// ── GET /riders/:id — Get rider profile ──────────────────────────────────────
router.get('/:id', authenticate, requireOwnOrManager, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT
         r.*, u.full_name, u.phone, u.email,
         o.name AS office_name, o.city AS office_city,
         res.today_pending, res.today_confirmed, res.week_total,
         res.month_total, res.lifetime_total
       FROM riders r
       JOIN users u ON u.user_id = r.user_id
       JOIN offices o ON o.office_id = r.home_office_id
       LEFT JOIN rider_earnings_summary res ON res.rider_id = r.rider_id
       WHERE r.rider_id = $1`,
      [id]
    );

    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Rider not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err: any) {
    console.error('GET /riders/:id error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to get rider' });
  }
});

// ── PATCH /riders/:id — Update rider profile (managers only) ─────────────────
router.patch('/:id', authenticate, requireRole('OFFICE_MANAGER', 'OPS_ADMIN'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const schema = z.object({
      vehicle_type:          z.enum(['MOTORCYCLE','BICYCLE','FOOT','CAR']).optional(),
      max_parcel_weight_kg:  z.number().positive().optional(),
      max_parcel_count:      z.number().int().positive().optional(),
      current_zone:          z.string().optional(),
      status:                z.enum(['ACTIVE','SUSPENDED','INACTIVE']).optional(),
    });
    const body = schema.parse(req.body);

    const setClauses = Object.entries(body).map(([k], i) => `${k} = $${i + 2}`).join(', ');
    const values     = Object.values(body);
    if (!setClauses) return res.status(400).json({ success: false, message: 'No fields to update' });

    const result = await db.query(
      `UPDATE riders SET ${setClauses} WHERE rider_id = $1 RETURNING *`,
      [id, ...values]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Rider not found' });

    res.json({ success: true, data: result.rows[0] });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── PATCH /riders/:id/status — Suspend or reactivate ────────────────────────
router.patch('/:id/status', authenticate, requireRole('OFFICE_MANAGER', 'OPS_ADMIN'), async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const { status, reason } = z.object({
      status: z.enum(['ACTIVE', 'SUSPENDED']),
      reason: z.string().min(1),
    }).parse(req.body);

    const result = await db.query(
      `UPDATE riders SET status = $2 WHERE rider_id = $1 RETURNING *`,
      [id, status]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Rider not found' });

    if (status === 'SUSPENDED') {
      // Cancel all active jobs
      await db.query(
        `UPDATE rider_jobs SET status = 'CANCELLED', cancelled_at = NOW(), cancellation_reason = $2
         WHERE rider_id = $1 AND status IN ('ASSIGNED','ACCEPTED','EN_ROUTE','ARRIVED')`,
        [id, `RIDER_SUSPENDED: ${reason}`]
      );
      // Remove from Redis availability
      await redis.set(`rider:${id}:online`, '0');
      await db.query(`UPDATE riders SET availability = 'OFFLINE' WHERE rider_id = $1`, [id]);

      await publishEvent('rider.management', {
        event_type: 'RIDER_SUSPENDED', rider_id: id,
        reason, suspended_by: req.actor.user_id, occurred_at: new Date().toISOString(),
      });
    }

    // Log to audit
    await db.query(
      `INSERT INTO audit_log (actor_id, action, target_id, target_type, detail, occurred_at)
       VALUES ($1, $2, $3, 'RIDER', $4, NOW())`,
      [req.actor.user_id, `RIDER_STATUS_${status}`, id, reason]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── GET /riders/:id/capacity — Capacity check ────────────────────────────────
router.get('/:id/capacity', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { additional_weight_kg = '0', additional_parcel_count = '1' } = req.query as any;
    const { checkCapacity } = await import('../capacity');
    const result = await checkCapacity(id, parseFloat(additional_weight_kg), parseInt(additional_parcel_count));
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /riders/:id/online — Rider goes online ──────────────────────────────
router.post('/:id/online', authenticate, async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    if (req.actor.user_id !== id && !['OFFICE_MANAGER','OPS_ADMIN'].includes(req.actor.role)) {
      return res.status(403).json({ success: false, message: 'Cannot set another rider online' });
    }

    const schema = z.object({ gps_lat: z.number(), gps_lng: z.number() });
    const { gps_lat, gps_lng } = schema.parse(req.body);

    const rider = await db.query(
      `SELECT home_office_id FROM riders WHERE rider_id = $1 AND status = 'ACTIVE'`,
      [id]
    );
    if (!rider.rows[0]) return res.status(404).json({ success: false, message: 'Rider not found or suspended' });

    const { home_office_id } = rider.rows[0];

    // Update DB
    await db.query(`UPDATE riders SET availability = 'ONLINE' WHERE rider_id = $1`, [id]);

    // Redis: online flag + location + GEO set
    await redis.set(`rider:${id}:online`, '1');
    await redis.set(`rider:${id}:location`, JSON.stringify({ lat: gps_lat, lng: gps_lng, last_updated: new Date().toISOString() }));
    await (redis as any).geoAdd(`geo:riders:${home_office_id}`, { longitude: gps_lng, latitude: gps_lat, member: id });

    await publishEvent('rider.availability', {
      event_type: 'RIDER_WENT_ONLINE', rider_id: id,
      office_id: home_office_id, gps: { lat: gps_lat, lng: gps_lng },
      occurred_at: new Date().toISOString(),
    }, { dedup_id: `online-${id}-${Date.now()}` });

    res.json({ success: true, data: { rider_id: id, availability: 'ONLINE' } });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── POST /riders/:id/offline — Rider goes offline ────────────────────────────
router.post('/:id/offline', authenticate, async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    if (req.actor.user_id !== id && !['OFFICE_MANAGER','OPS_ADMIN'].includes(req.actor.role)) {
      return res.status(403).json({ success: false, message: 'Cannot set another rider offline' });
    }

    // Guard: cannot go offline with active jobs
    const activeJobs = await db.query(
      `SELECT job_id FROM rider_jobs
       WHERE rider_id = $1 AND status IN ('ASSIGNED','ACCEPTED','EN_ROUTE')`,
      [id]
    );
    if (activeJobs.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'ACTIVE_JOBS_EXIST: Complete or cancel active jobs before going offline',
        active_job_count: activeJobs.rows.length,
      });
    }

    const rider = await db.query(`SELECT home_office_id FROM riders WHERE rider_id = $1`, [id]);
    const { home_office_id } = rider.rows[0];

    await db.query(`UPDATE riders SET availability = 'OFFLINE' WHERE rider_id = $1`, [id]);
    await redis.set(`rider:${id}:online`, '0');
    await (redis as any).zRem(`geo:riders:${home_office_id}`, id);

    await publishEvent('rider.availability', {
      event_type: 'RIDER_WENT_OFFLINE', rider_id: id,
      office_id: home_office_id, occurred_at: new Date().toISOString(),
    }, { dedup_id: `offline-${id}-${Date.now()}` });

    res.json({ success: true, data: { rider_id: id, availability: 'OFFLINE' } });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

export default router;