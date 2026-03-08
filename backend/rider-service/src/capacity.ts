import { db } from './db';
import { redis } from './redis';

export interface CapacityResult {
  can_take:              boolean;
  reason?:               string;
  current_weight_kg:     number;
  current_count:         number;
  max_weight_kg:         number;
  max_count:             number;
  available_weight_kg?:  number;
  available_count?:      number;
}

// ── Check if a rider can take an additional job ──────────────────────────────
export async function checkCapacity(
  riderId:              string,
  additionalWeightKg:   number,
  additionalCount:      number = 1
): Promise<CapacityResult> {
  const riderRes = await db.query(
    `SELECT max_parcel_weight_kg, max_parcel_count FROM riders WHERE rider_id = $1`,
    [riderId]
  );

  if (!riderRes.rows[0]) {
    return { can_take: false, reason: 'RIDER_NOT_FOUND', current_weight_kg: 0, current_count: 0, max_weight_kg: 0, max_count: 0 };
  }

  const { max_parcel_weight_kg, max_parcel_count } = riderRes.rows[0];

  // Use COALESCE(confirmed_weight_kg, declared_weight_kg * 1.2) — 20% buffer for pre-measurement parcels
  const activeRes = await db.query(
    `SELECT
       COALESCE(SUM(COALESCE(p.confirmed_weight_kg, p.declared_weight_kg * 1.2)), 0) AS total_weight,
       COUNT(*) AS total_count
     FROM rider_jobs rj
     JOIN parcels p ON p.parcel_id = rj.parcel_id
     WHERE rj.rider_id = $1
       AND rj.status IN ('ASSIGNED','ACCEPTED','EN_ROUTE','ARRIVED')`,
    [riderId]
  );

  const currentWeight = parseFloat(activeRes.rows[0].total_weight);
  const currentCount  = parseInt(activeRes.rows[0].total_count);
  const newWeight     = currentWeight + additionalWeightKg;
  const newCount      = currentCount  + additionalCount;

  if (newWeight > max_parcel_weight_kg) {
    return {
      can_take: false, reason: 'WEIGHT_LIMIT_EXCEEDED',
      current_weight_kg: currentWeight, current_count: currentCount,
      max_weight_kg: max_parcel_weight_kg, max_count: max_parcel_count,
    };
  }
  if (newCount > max_parcel_count) {
    return {
      can_take: false, reason: 'COUNT_LIMIT_EXCEEDED',
      current_weight_kg: currentWeight, current_count: currentCount,
      max_weight_kg: max_parcel_weight_kg, max_count: max_parcel_count,
    };
  }

  return {
    can_take: true,
    current_weight_kg:    currentWeight,
    current_count:        currentCount,
    max_weight_kg:        max_parcel_weight_kg,
    max_count:            max_parcel_count,
    available_weight_kg:  max_parcel_weight_kg - newWeight,
    available_count:      max_parcel_count - newCount,
  };
}

// ── Redis distributed lock for assignment race condition ──────────────────────
// Critical: prevents two ML workers from double-assigning the same rider
export async function acquireAssignLock(parcelId: string): Promise<boolean> {
  const key    = `assign_lock:${parcelId}`;
  const result = await redis.set(key, '1', { NX: true, EX: 30 }); // 30s TTL
  return result === 'OK';
}

export async function releaseAssignLock(parcelId: string): Promise<void> {
  await redis.del(`assign_lock:${parcelId}`);
}

// ── Update rider_earnings_summary (denormalised — fast app reads) ─────────────
export async function updateEarningsSummary(riderId: string): Promise<void> {
  await db.query(
    `INSERT INTO rider_earnings_summary (
       rider_id, today_pending, today_confirmed, week_total, month_total, lifetime_total, last_updated
     )
     SELECT
       $1,
       COALESCE(SUM(earning_amount) FILTER (WHERE earning_status = 'PENDING'  AND completed_at::date = CURRENT_DATE), 0),
       COALESCE(SUM(earning_amount) FILTER (WHERE earning_status = 'CONFIRMED' AND completed_at::date = CURRENT_DATE), 0),
       COALESCE(SUM(earning_amount) FILTER (WHERE earning_status = 'CONFIRMED' AND completed_at >= NOW() - INTERVAL '7 days'), 0),
       COALESCE(SUM(earning_amount) FILTER (WHERE earning_status = 'CONFIRMED' AND completed_at >= NOW() - INTERVAL '30 days'), 0),
       COALESCE(SUM(earning_amount) FILTER (WHERE earning_status IN ('CONFIRMED','PAID')), 0),
       NOW()
     FROM rider_jobs
     WHERE rider_id = $1 AND status = 'COMPLETED'
     ON CONFLICT (rider_id) DO UPDATE SET
       today_pending    = EXCLUDED.today_pending,
       today_confirmed  = EXCLUDED.today_confirmed,
       week_total       = EXCLUDED.week_total,
       month_total      = EXCLUDED.month_total,
       lifetime_total   = EXCLUDED.lifetime_total,
       last_updated     = NOW()`,
    [riderId]
  );
}

// ── Update rider performance metrics — only on job completion ────────────────
export async function updatePerformanceMetrics(riderId: string): Promise<void> {
  const res = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'COMPLETED')                    AS total_completed,
       COUNT(*) FILTER (WHERE status = 'COMPLETED' AND was_on_time)    AS on_time_count,
       COUNT(*) FILTER (WHERE status = 'COMPLETED' AND job_type = 'LAST_MILE_DELIVERY') AS delivery_total,
       COUNT(*) FILTER (WHERE status = 'COMPLETED' AND job_type = 'LAST_MILE_DELIVERY' AND was_on_time) AS delivery_on_time
     FROM rider_jobs
     WHERE rider_id = $1`,
    [riderId]
  );

  const { total_completed, on_time_count, delivery_total, delivery_on_time } = res.rows[0];
  const onTimeRate         = total_completed > 0 ? on_time_count / total_completed : 1.0;
  const deliverySuccessRate = delivery_total > 0 ? delivery_on_time / delivery_total : 1.0;

  await db.query(
    `UPDATE riders SET
       on_time_rate          = $2,
       delivery_success_rate = $3,
       total_jobs_completed  = $4
     WHERE rider_id = $1`,
    [riderId, onTimeRate, deliverySuccessRate, total_completed]
  );
}