import { Router, Response } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { redis } from '../redis';
import { publishEvent } from '../qstash';
import { authenticate, requireRole } from '../middleware';
import { checkCapacity, acquireAssignLock, releaseAssignLock } from '../capacity';

const router = Router();

// ── GET /riders/:id/jobs — All jobs for a rider ──────────────────────────────
router.get('/:id/jobs', authenticate, async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const { status, date, page = '1', limit = '20' } = req.query as any;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const isOwn    = req.actor.user_id === id;
    const isManager = ['OFFICE_MANAGER','OPS_ADMIN'].includes(req.actor.role);
    if (!isOwn && !isManager) return res.status(403).json({ success: false, message: 'Access denied' });

    const conditions: string[] = ['rj.rider_id = $1'];
    const params: any[]        = [id];
    let pi = 2;

    if (status) { conditions.push(`rj.status = $${pi++}`); params.push(status); }
    if (date)   { conditions.push(`rj.assigned_at::date = $${pi++}`); params.push(date); }

    const result = await db.query(
      `SELECT
         rj.*, p.booking_reference, p.item_category, p.is_fragile,
         p.declared_weight_kg, p.confirmed_weight_kg,
         u_sender.full_name AS sender_name, u_sender.phone AS sender_phone
       FROM rider_jobs rj
       JOIN parcels p ON p.parcel_id = rj.parcel_id
       JOIN users u_sender ON u_sender.user_id = p.sender_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY rj.assigned_at DESC
       LIMIT $${pi++} OFFSET $${pi++}`,
      [...params, parseInt(limit), offset]
    );

    res.json({ success: true, data: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /riders/:id/jobs/active — Active jobs (Redis projection) ─────────────
router.get('/:id/jobs/active', authenticate, async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    if (req.actor.user_id !== id && !['OFFICE_MANAGER','OPS_ADMIN'].includes(req.actor.role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Try Redis projection first for speed
    const cached = await redis.get(`rider:${id}:jobs`);
    if (cached) {
      return res.json({ success: true, data: JSON.parse(cached), source: 'cache' });
    }

    // Fall back to DB
    const result = await db.query(
      `SELECT
         rj.job_id, rj.parcel_id, rj.job_type, rj.status,
         rj.pickup_address, rj.pickup_gps_lat, rj.pickup_gps_lng,
         rj.delivery_address, rj.delivery_gps_lat, rj.delivery_gps_lng,
         rj.earning_amount, rj.assigned_at, rj.accepted_at, rj.started_at,
         p.booking_reference, p.item_category, p.is_fragile,
         p.declared_weight_kg, p.confirmed_weight_kg,
         u_sender.full_name AS sender_name, u_sender.phone AS sender_phone
       FROM rider_jobs rj
       JOIN parcels p ON p.parcel_id = rj.parcel_id
       JOIN users u_sender ON u_sender.user_id = p.sender_id
       WHERE rj.rider_id = $1
         AND rj.status IN ('ASSIGNED','ACCEPTED','EN_ROUTE','ARRIVED')
       ORDER BY rj.assigned_at ASC`,
      [id]
    );

    const totalWeight = result.rows.reduce(
      (sum: number, j: any) => sum + parseFloat(j.confirmed_weight_kg || j.declared_weight_kg || 0), 0
    );
    const rider = await db.query(
      `SELECT max_parcel_weight_kg FROM riders WHERE rider_id = $1`, [id]
    );

    const payload = {
      active_jobs:             result.rows,
      total_active:            result.rows.length,
      total_weight_carrying_kg: totalWeight,
      capacity_remaining_kg:   (rider.rows[0]?.max_parcel_weight_kg || 15) - totalWeight,
    };

    // Cache in Redis for 30s
    await redis.set(`rider:${id}:jobs`, JSON.stringify(payload), { EX: 30 });
    res.json({ success: true, data: payload, source: 'db' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /jobs/assign — Assign a job to a rider ──────────────────────────────
router.post('/jobs/assign', authenticate, async (req: any, res: Response) => {
  const isSystem  = req.actor.role === 'SYSTEM';
  const isManager = ['OFFICE_MANAGER','OPS_ADMIN'].includes(req.actor.role);
  if (!isSystem && !isManager) {
    return res.status(403).json({ success: false, message: 'Only ML system or managers can assign jobs' });
  }

  try {
    const schema = z.object({
      rider_id:        z.string().uuid(),
      parcel_id:       z.string().uuid(),
      job_type:        z.enum(['PICKUP','LAST_MILE_DELIVERY','OFFICE_TO_COURIER','COURIER_TO_OFFICE']),
      override_reason: z.string().optional(),
    });
    const { rider_id, parcel_id, job_type, override_reason } = schema.parse(req.body);

    // Acquire distributed lock — critical race condition guard
    const locked = await acquireAssignLock(parcel_id);
    if (!locked) {
      return res.status(409).json({
        success: false, message: 'ASSIGNMENT_IN_PROGRESS: Another assignment is being processed for this parcel',
      });
    }

    try {
      // Get parcel data for capacity + earning calculation
      const parcelRes = await db.query(
        `SELECT p.*, u_s.full_name AS sender_name, u_s.phone AS sender_phone,
                u_r.full_name AS receiver_name, u_r.phone AS receiver_phone,
                o_orig.address AS origin_address, o_orig.gps_lat AS origin_lat, o_orig.gps_lng AS origin_lng,
                o_dest.address AS dest_address
         FROM parcels p
         JOIN users u_s ON u_s.user_id = p.sender_id
         JOIN users u_r ON u_r.user_id = p.receiver_id
         JOIN offices o_orig ON o_orig.office_id = p.origin_office_id
         JOIN offices o_dest ON o_dest.office_id = p.dest_office_id
         WHERE p.parcel_id = $1`,
        [parcel_id]
      );
      if (!parcelRes.rows[0]) {
        return res.status(404).json({ success: false, message: 'Parcel not found' });
      }
      const parcel = parcelRes.rows[0];
      const weight = parseFloat(parcel.confirmed_weight_kg || parcel.declared_weight_kg * 1.2);

      // Final capacity check — race condition guard
      const capacity = await checkCapacity(rider_id, weight, 1);
      if (!capacity.can_take) {
        return res.status(409).json({
          success: false,
          message: `CAPACITY_EXCEEDED: ${capacity.reason}`,
          data: capacity,
        });
      }

      // Determine addresses and earning based on job type
      const earningMap: Record<string, number> = {
        PICKUP:              1500,
        LAST_MILE_DELIVERY:  2000,
        OFFICE_TO_COURIER:   1000,
        COURIER_TO_OFFICE:   1000,
      };
      const earningAmount    = earningMap[job_type] || 1500;
      const pickupAddress    = job_type === 'PICKUP' ? parcel.sender_address : parcel.origin_address;
      const pickupLat        = job_type === 'PICKUP' ? parcel.pickup_gps_lat  : parcel.origin_lat;
      const pickupLng        = job_type === 'PICKUP' ? parcel.pickup_gps_lng  : parcel.origin_lng;
      const deliveryAddress  = job_type === 'LAST_MILE_DELIVERY' ? parcel.receiver_address : null;
      const deliveryLat      = job_type === 'LAST_MILE_DELIVERY' ? parcel.delivery_gps_lat  : null;
      const deliveryLng      = job_type === 'LAST_MILE_DELIVERY' ? parcel.delivery_gps_lng  : null;

      // Insert job
      const jobRes = await db.query(
        `INSERT INTO rider_jobs (
           rider_id, parcel_id, job_type, status,
           pickup_address, pickup_gps_lat, pickup_gps_lng,
           delivery_address, delivery_gps_lat, delivery_gps_lng,
           assigned_at, earning_amount, earning_status
         ) VALUES ($1,$2,$3,'ASSIGNED',$4,$5,$6,$7,$8,$9,NOW(),$10,'PENDING')
         RETURNING *`,
        [rider_id, parcel_id, job_type,
         pickupAddress, pickupLat, pickupLng,
         deliveryAddress, deliveryLat, deliveryLng,
         earningAmount]
      );
      const job = jobRes.rows[0];

      // Set rider availability to ON_JOB if first active job
      await db.query(
        `UPDATE riders SET availability = 'ON_JOB'
         WHERE rider_id = $1 AND availability = 'ONLINE'`,
        [rider_id]
      );

      // Update Redis jobs projection
      const activeJobs = await db.query(
        `SELECT rj.*, p.booking_reference, p.item_category, p.is_fragile, p.declared_weight_kg
         FROM rider_jobs rj JOIN parcels p ON p.parcel_id = rj.parcel_id
         WHERE rj.rider_id = $1 AND rj.status IN ('ASSIGNED','ACCEPTED','EN_ROUTE','ARRIVED')`,
        [rider_id]
      );
      await redis.set(`rider:${rider_id}:jobs`, JSON.stringify({ active_jobs: activeJobs.rows }), { EX: 300 });

      // Publish event
      await publishEvent('rider.jobs', {
        event_type: 'RIDER_JOB_ASSIGNED',
        job_id:     job.job_id,
        rider_id,
        parcel_id,
        job_type,
        pickup_address:  pickupAddress,
        pickup_gps:      { lat: pickupLat, lng: pickupLng },
        earning_amount:  earningAmount,
        sender_name:     parcel.sender_name,
        sender_phone:    parcel.sender_phone,
        booking_reference: parcel.booking_reference,
        occurred_at:     new Date().toISOString(),
      }, { dedup_id: `assign-${job.job_id}` });

      res.status(201).json({
        success: true,
        data: {
          job_id:          job.job_id,
          rider_id,
          parcel_id,
          job_type,
          status:          'ASSIGNED',
          pickup_address:  pickupAddress,
          pickup_gps:      { lat: pickupLat, lng: pickupLng },
          assigned_at:     job.assigned_at,
          earning_amount:  earningAmount,
        },
      });
    } finally {
      await releaseAssignLock(parcel_id);
    }
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── POST /jobs/:job_id/accept — Rider accepts a job ──────────────────────────
router.post('/jobs/:job_id/accept', authenticate, async (req: any, res: Response) => {
  try {
    const { job_id } = req.params;
    const job = await db.query(
      `SELECT * FROM rider_jobs WHERE job_id = $1`, [job_id]
    );
    if (!job.rows[0]) return res.status(404).json({ success: false, message: 'Job not found' });
    if (job.rows[0].rider_id !== req.actor.user_id) {
      return res.status(403).json({ success: false, message: 'Not your job' });
    }
    if (job.rows[0].status !== 'ASSIGNED') {
      return res.status(409).json({ success: false, message: `Cannot accept job in status: ${job.rows[0].status}` });
    }

    const result = await db.query(
      `UPDATE rider_jobs SET status = 'ACCEPTED', accepted_at = NOW()
       WHERE job_id = $1 RETURNING *`,
      [job_id]
    );

    // Invalidate Redis jobs projection
    await redis.del(`rider:${req.actor.user_id}:jobs`);

    await publishEvent('rider.jobs', {
      event_type: 'RIDER_JOB_ACCEPTED',
      job_id, rider_id: job.rows[0].rider_id,
      parcel_id: job.rows[0].parcel_id,
      occurred_at: new Date().toISOString(),
    }, { dedup_id: `accept-${job_id}` });

    res.json({ success: true, data: result.rows[0] });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── POST /jobs/:job_id/start — Rider starts moving ───────────────────────────
router.post('/jobs/:job_id/start', authenticate, async (req: any, res: Response) => {
  try {
    const { job_id } = req.params;
    const job = await db.query(`SELECT * FROM rider_jobs WHERE job_id = $1`, [job_id]);
    if (!job.rows[0]) return res.status(404).json({ success: false, message: 'Job not found' });
    if (job.rows[0].rider_id !== req.actor.user_id) {
      return res.status(403).json({ success: false, message: 'Not your job' });
    }
    if (!['ASSIGNED','ACCEPTED'].includes(job.rows[0].status)) {
      return res.status(409).json({ success: false, message: `Cannot start job in status: ${job.rows[0].status}` });
    }

    await db.query(
      `UPDATE rider_jobs SET status = 'EN_ROUTE', started_at = NOW() WHERE job_id = $1`,
      [job_id]
    );
    await redis.del(`rider:${req.actor.user_id}:jobs`);

    await publishEvent('rider.jobs', {
      event_type: 'RIDER_JOB_STARTED', job_id,
      rider_id:  job.rows[0].rider_id, parcel_id: job.rows[0].parcel_id,
      occurred_at: new Date().toISOString(),
    });

    res.json({ success: true, data: { job_id, status: 'EN_ROUTE' } });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── POST /jobs/:job_id/arrived — Rider arrived ───────────────────────────────
router.post('/jobs/:job_id/arrived', authenticate, async (req: any, res: Response) => {
  try {
    const { job_id } = req.params;
    const { gps_lat, gps_lng } = z.object({
      gps_lat: z.number(), gps_lng: z.number(),
    }).parse(req.body);

    const job = await db.query(`SELECT * FROM rider_jobs WHERE job_id = $1`, [job_id]);
    if (!job.rows[0]) return res.status(404).json({ success: false, message: 'Job not found' });
    if (job.rows[0].rider_id !== req.actor.user_id) {
      return res.status(403).json({ success: false, message: 'Not your job' });
    }

    await db.query(
      `UPDATE rider_jobs SET status = 'ARRIVED' WHERE job_id = $1`, [job_id]
    );
    await redis.del(`rider:${req.actor.user_id}:jobs`);

    const eventType = job.rows[0].job_type === 'PICKUP'
      ? 'PARCEL_RIDER_ARRIVED_AT_SENDER'
      : 'PARCEL_LAST_MILE_ARRIVED_AT_RECEIVER';

    await publishEvent('parcel.events', {
      event_type: eventType, job_id,
      rider_id: job.rows[0].rider_id, parcel_id: job.rows[0].parcel_id,
      gps: { lat: gps_lat, lng: gps_lng }, occurred_at: new Date().toISOString(),
    });

    res.json({ success: true, data: { job_id, status: 'ARRIVED', event_fired: eventType } });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── POST /jobs/:job_id/cancel — Cancel a job ─────────────────────────────────
router.post('/jobs/:job_id/cancel', authenticate, async (req: any, res: Response) => {
  try {
    const { job_id } = req.params;
    const { reason_code, reason_detail } = z.object({
      reason_code:   z.string(),
      reason_detail: z.string(),
    }).parse(req.body);

    const job = await db.query(`SELECT * FROM rider_jobs WHERE job_id = $1`, [job_id]);
    if (!job.rows[0]) return res.status(404).json({ success: false, message: 'Job not found' });

    const isOwn     = job.rows[0].rider_id === req.actor.user_id;
    const isManager = ['OFFICE_MANAGER','OPS_ADMIN'].includes(req.actor.role);
    if (!isOwn && !isManager) return res.status(403).json({ success: false, message: 'Access denied' });

    // Rider can only cancel before EN_ROUTE
    if (isOwn && job.rows[0].status === 'EN_ROUTE') {
      return res.status(409).json({
        success: false,
        message: 'Cannot cancel after starting. Contact manager.',
      });
    }

    await db.query(
      `UPDATE rider_jobs SET status = 'CANCELLED', cancelled_at = NOW(),
       cancellation_reason = $2 WHERE job_id = $1`,
      [job_id, `${reason_code}: ${reason_detail}`]
    );

    // If no more active jobs, set rider back to ONLINE
    const remaining = await db.query(
      `SELECT COUNT(*) FROM rider_jobs
       WHERE rider_id = $1 AND status IN ('ASSIGNED','ACCEPTED','EN_ROUTE','ARRIVED')`,
      [job.rows[0].rider_id]
    );
    if (parseInt(remaining.rows[0].count) === 0) {
      await db.query(
        `UPDATE riders SET availability = 'ONLINE' WHERE rider_id = $1`, [job.rows[0].rider_id]
      );
    }
    await redis.del(`rider:${job.rows[0].rider_id}:jobs`);

    await publishEvent('rider.jobs', {
      event_type: 'RIDER_JOB_CANCELLED', job_id,
      rider_id: job.rows[0].rider_id, parcel_id: job.rows[0].parcel_id,
      reason_code, reason_detail, occurred_at: new Date().toISOString(),
    }, { dedup_id: `cancel-${job_id}` });

    res.json({ success: true, data: { job_id, status: 'CANCELLED' } });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

export default router;