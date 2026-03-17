import { db }    from '../db';
import { redis } from '../redis';

// QStash client
async function publishSLACheck(params: {
  parcel_id:   string;
  sla_type:    string;
  office_id:   string;
  expected_by: Date;
  delay_secs:  number;
}) {
  const url   = process.env.QSTASH_URL;
  const token = process.env.QSTASH_TOKEN;
  const callbackUrl = `${process.env.SERVICE_URL || 'http://localhost:3004'}/sla/check`;

  if (!url || !token) {
    console.log(`[SLA DEV] Timer: ${params.sla_type} for ${params.parcel_id} in ${params.delay_secs}s`);
    return;
  }

  await fetch(`${url}/v2/publish/${encodeURIComponent(callbackUrl)}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
      'Upstash-Delay': `${params.delay_secs}s`,
      'Upstash-Dedup-Id': `sla:${params.parcel_id}:${params.sla_type}`,
    },
    body: JSON.stringify({
      parcel_id:   params.parcel_id,
      sla_type:    params.sla_type,
      office_id:   params.office_id,
      expected_by: params.expected_by.toISOString(),
    }),
  });
}

// SLA durations in seconds per type
const SLA_DURATIONS: Record<string, number> = {
  RIDER_ASSIGNMENT:     30  * 60,
  PICKUP_COLLECTION:    4   * 3600,
  ORIGIN_INTAKE:        4   * 3600,
  MEASUREMENT:          2   * 3600,
  PACKING:              8   * 3600,
  DISPATCH:             2   * 3600,
  DEST_INTAKE:          2   * 3600,
  LAST_MILE_ASSIGNMENT: 1   * 3600,
  LAST_MILE_DELIVERY:   4   * 3600,
  REATTEMPT:            24  * 3600,
  RETURN_DISPATCH:      48  * 3600,
  PAYMENT_CONFIRM:      15  * 60,
};

// ─── Start an SLA timer ────────────────────────────────────────────────────
export async function startSLA(params: {
  parcel_id: string;
  sla_type:  string;
  office_id: string;
  custom_duration_secs?: number;
}) {
  const duration  = params.custom_duration_secs ?? SLA_DURATIONS[params.sla_type];
  if (!duration) throw new Error(`Unknown SLA type: ${params.sla_type}`);

  const expected_by = new Date(Date.now() + duration * 1000);

  // Redis: mark SLA as started — used by breach check
  await redis.setEx(
    `sla:started:${params.parcel_id}:${params.sla_type}`,
    duration + 3600, // keep 1h after expiry for audit
    expected_by.toISOString()
  );

  // QStash: schedule the breach check
  await publishSLACheck({
    parcel_id:   params.parcel_id,
    sla_type:    params.sla_type,
    office_id:   params.office_id,
    expected_by,
    delay_secs:  duration,
  });
}

// ─── Cancel an SLA timer (stage completed on time) ────────────────────────
export async function completeSLA(parcel_id: string, sla_type: string) {
  await redis.setEx(
    `sla:completed:${parcel_id}:${sla_type}`,
    86400, // keep for 24h for audit
    new Date().toISOString()
  );
}

// ─── Handle SLA breach check (called by QStash) ───────────────────────────
export async function handleSLACheck(params: {
  parcel_id:   string;
  sla_type:    string;
  office_id:   string;
  expected_by: string;
}) {
  // Was it completed on time?
  const completed = await redis.get(`sla:completed:${params.parcel_id}:${params.sla_type}`);
  if (completed) return { breached: false };

  // Was it paused?
  const paused = await redis.get(`sla:paused:${params.office_id}`);
  if (paused) return { breached: false, paused: true };

  // BREACHED — record it
  const { rows: [breach] } = await db.query(
    `INSERT INTO sla_breaches
       (parcel_id, sla_type, office_id, expected_by, breached_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT DO NOTHING
     RETURNING breach_id`,
    [params.parcel_id, params.sla_type, params.office_id, params.expected_by]
  );

  if (!breach) return { breached: false }; // already recorded

  // Get escalation config for this office + sla type
  const { rows: [config] } = await db.query(
    `SELECT escalation_l1_role, escalation_l2_role, escalation_l3_role
     FROM office_sla_config
     WHERE office_id = $1 AND sla_type = $2`,
    [params.office_id, params.sla_type]
  );

  return {
    breached:       true,
    breach_id:      breach.breach_id,
    escalation_l1:  config?.escalation_l1_role ?? 'OFFICE_MANAGER',
    escalation_l2:  config?.escalation_l2_role ?? 'BRANCH_MANAGER',
    escalation_l3:  config?.escalation_l3_role ?? 'OPS_ADMIN',
  };
}

// ─── Pause all SLAs for an office (emergency) ─────────────────────────────
export async function pauseOfficeSLA(office_id: string, reason: string, paused_by: string) {
  const pauseUntil = new Date(Date.now() + 7 * 24 * 3600 * 1000); // max 7 days

  await redis.setEx(
    `sla:paused:${office_id}`,
    7 * 24 * 3600,
    JSON.stringify({ reason, paused_by, paused_at: new Date().toISOString() })
  );

  await db.query(
    `INSERT INTO sla_pauses (office_id, reason, paused_by, paused_at)
     VALUES ($1, $2, $3, NOW())`,
    [office_id, reason, paused_by]
  );
}

// ─── Resume SLAs for an office ────────────────────────────────────────────
export async function resumeOfficeSLA(office_id: string, resumed_by: string) {
  await redis.del(`sla:paused:${office_id}`);

  await db.query(
    `UPDATE sla_pauses SET resumed_at = NOW(), resumed_by = $1
     WHERE office_id = $2 AND resumed_at IS NULL`,
    [resumed_by, office_id]
  );
}
