import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../db';
import { redis } from '../redis';
import { publishEvent } from '../qstash';
import { updateEarningsSummary, updatePerformanceMetrics } from '../capacity';

const router = Router();

// ── Verify QStash signature ──────────────────────────────────────────────────
function verifyQStash(req: Request): boolean {
  const sig     = req.headers['upstash-signature'] as string;
  const current = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const next    = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!sig || (!current && !next)) return true; // Dev mode
  try {
    const body    = JSON.stringify(req.body);
    const checkKey = (key: string) =>
      crypto.createHmac('sha256', key).update(body).digest('base64') === sig;
    return (current && checkKey(current)) || (next && checkKey(next)) || false;
  } catch { return false; }
}

// ── POST /webhooks/parcel/delivered ─────────────────────────────────────────
// PARCEL_DELIVERY_CONFIRMED → confirm earning, update metrics, check availability
router.post('/parcel/delivered', async (req: Request, res: Response) => {
  if (!verifyQStash(req)) return res.status(401).json({ success: false, message: 'Invalid signature' });

  try {
    const { parcel_id, rider_id, occurred_at } = req.body;
    if (!parcel_id || !rider_id) return res.status(400).json({ success: false, message: 'Missing fields' });

    // Find the delivery job
    const jobRes = await db.query(
      `SELECT * FROM rider_jobs
       WHERE parcel_id = $1 AND rider_id = $2
         AND job_type IN ('LAST_MILE_DELIVERY','PICKUP')
         AND status IN ('ASSIGNED','ACCEPTED','EN_ROUTE','ARRIVED')
       ORDER BY assigned_at DESC LIMIT 1`,
      [parcel_id, rider_id]
    );

    if (!jobRes.rows[0]) {
      console.log(`[webhook/delivered] No active job found for parcel ${parcel_id} rider ${rider_id}`);
      return res.json({ success: true, message: 'Idempotent — already processed' });
    }

    const job      = jobRes.rows[0];
    const startedAt = job.accepted_at || job.assigned_at;
    const endedAt   = new Date(occurred_at || Date.now());
    const durationMins = Math.round((endedAt.getTime() - new Date(startedAt).getTime()) / 60000);
    const wasOnTime = durationMins <= (job.estimated_duration_mins || 999);

    // Complete job + confirm earning
    await db.query(
      `UPDATE rider_jobs SET
         status         = 'COMPLETED',
         completed_at   = $2,
         earning_status = 'CONFIRMED',
         actual_duration_mins = $3,
         was_on_time    = $4
       WHERE job_id = $1`,
      [job.job_id, endedAt, durationMins, wasOnTime]
    );

    // Update denormalised earnings summary — never compute on every read
    await updateEarningsSummary(rider_id);

    // Update on_time_rate only on job completion — never on GPS ping
    await updatePerformanceMetrics(rider_id);

    // Only set availability = ONLINE if NO MORE active jobs
    const remaining = await db.query(
      `SELECT COUNT(*) FROM rider_jobs
       WHERE rider_id = $1 AND status IN ('ASSIGNED','ACCEPTED','EN_ROUTE','ARRIVED')`,
      [rider_id]
    );
    if (parseInt(remaining.rows[0].count) === 0) {
      await db.query(`UPDATE riders SET availability = 'ONLINE' WHERE rider_id = $1`, [rider_id]);
    }

    // Invalidate Redis cache
    await redis.del(`rider:${rider_id}:jobs`);

    await publishEvent('rider.jobs', {
      event_type: 'RIDER_JOB_COMPLETED', job_id: job.job_id,
      rider_id, parcel_id, was_on_time: wasOnTime,
      earning_amount: job.earning_amount, occurred_at: endedAt.toISOString(),
    }, { dedup_id: `completed-${job.job_id}` });

    res.json({ success: true, data: { job_id: job.job_id, earning_confirmed: job.earning_amount } });
  } catch (err: any) {
    console.error('[webhook/delivered] error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /webhooks/parcel/route-switched ─────────────────────────────────────
// ROUTE_SWITCH_EXECUTED → cancel affected jobs, re-trigger ML assignment
router.post('/parcel/route-switched', async (req: Request, res: Response) => {
  if (!verifyQStash(req)) return res.status(401).json({ success: false, message: 'Invalid signature' });

  try {
    const { parcel_id, old_route, new_route, affected_rider_id } = req.body;

    if (affected_rider_id) {
      // Cancel affected rider job
      await db.query(
        `UPDATE rider_jobs SET status = 'CANCELLED', cancelled_at = NOW(),
         cancellation_reason = 'ROUTE_SWITCH: route changed from ${old_route} to ${new_route}'
         WHERE rider_id = $1 AND parcel_id = $2
           AND status IN ('ASSIGNED','ACCEPTED')`,
        [affected_rider_id, parcel_id]
      );

      // Check if rider has other active jobs
      const remaining = await db.query(
        `SELECT COUNT(*) FROM rider_jobs
         WHERE rider_id = $1 AND status IN ('ASSIGNED','ACCEPTED','EN_ROUTE','ARRIVED')`,
        [affected_rider_id]
      );
      if (parseInt(remaining.rows[0].count) === 0) {
        await db.query(
          `UPDATE riders SET availability = 'ONLINE' WHERE rider_id = $1`, [affected_rider_id]
        );
      }
      await redis.del(`rider:${affected_rider_id}:jobs`);

      await publishEvent('rider.jobs', {
        event_type: 'RIDER_JOB_CANCELLED_ROUTE_SWITCH',
        rider_id: affected_rider_id, parcel_id, old_route, new_route,
        occurred_at: new Date().toISOString(),
      });
    }

    // Signal ML to re-assign if new route still needs a rider
    if (new_route?.includes('D1')) {
      await publishEvent('ml.assignment', {
        event_type: 'REASSIGNMENT_NEEDED', parcel_id,
        reason: 'ROUTE_SWITCH', occurred_at: new Date().toISOString(),
      });
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('[webhook/route-switched] error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /webhooks/parcel/rider-assigned ─────────────────────────────────────
// Sync job creation from Parcel Service (idempotent)
router.post('/parcel/rider-assigned', async (req: Request, res: Response) => {
  if (!verifyQStash(req)) return res.status(401).json({ success: false, message: 'Invalid signature' });

  try {
    const { parcel_id, rider_id, job_type, event_type } = req.body;

    // Idempotent — check if job already exists
    const existing = await db.query(
      `SELECT job_id FROM rider_jobs WHERE parcel_id = $1 AND rider_id = $2 AND job_type = $3`,
      [parcel_id, rider_id, job_type]
    );
    if (existing.rows[0]) {
      return res.json({ success: true, message: 'Idempotent — job already exists', job_id: existing.rows[0].job_id });
    }

    // Job was created via /jobs/assign — this webhook is just a sync confirmation
    // Update Redis projection
    const activeJobs = await db.query(
      `SELECT rj.*, p.booking_reference FROM rider_jobs rj
       JOIN parcels p ON p.parcel_id = rj.parcel_id
       WHERE rj.rider_id = $1 AND rj.status IN ('ASSIGNED','ACCEPTED','EN_ROUTE','ARRIVED')`,
      [rider_id]
    );
    await redis.set(`rider:${rider_id}:jobs`, JSON.stringify({ active_jobs: activeJobs.rows }), { EX: 300 });

    res.json({ success: true, message: 'Redis projection refreshed' });
  } catch (err: any) {
    console.error('[webhook/rider-assigned] error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;