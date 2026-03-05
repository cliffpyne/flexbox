import { Router } from 'express';
import { db } from '../db';
import { redis } from '../redis';
import { authenticate, requireRole } from '../middleware';
import { UserRole } from '@flexbox/types';

const router = Router({ mergeParams: true });

// ================================================================
// GET /offices/:id/intake-queue
// Real-time list of parcels waiting at this office
// Reads from Redis — NOT the DB
// ================================================================
router.get('/intake-queue', authenticate, async (req: any, res) => {
  try {
    // Try Redis first — this is the fast path
    const cached = await redis.get(`office:${req.params.id}:dashboard`);
    if (cached) {
      const dashboard = JSON.parse(cached);
      return res.json({ success: true, data: dashboard.intake_queue || [] });
    }

    // Fallback — build from DB if Redis is cold
    const { rows } = await db.query(
      `SELECT
         p.parcel_id, p.booking_reference,
         u.full_name as sender_name,
         p.item_category,
         p.declared_weight_kg,
         p.declared_length_cm, p.declared_width_cm, p.declared_height_cm,
         pe.occurred_at as arrived_at,
         EXTRACT(EPOCH FROM (NOW() - pe.occurred_at))/60 as minutes_waiting,
         o.sla_config->>'intake_sla_hours' as sla_hours
       FROM parcels p
       JOIN app_users u ON u.user_id = p.sender_id
       JOIN offices o ON o.office_id = p.origin_office_id
       JOIN parcel_events pe ON pe.parcel_id = p.parcel_id
         AND pe.event_type = 'PARCEL_OFFICE_RECEIVED'
         AND pe.sequence_number = (
           SELECT MAX(sequence_number) FROM parcel_events
           WHERE parcel_id = p.parcel_id
           AND event_type = 'PARCEL_OFFICE_RECEIVED'
         )
       WHERE p.origin_office_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM parcel_events
           WHERE parcel_id = p.parcel_id
           AND event_type IN ('PARCEL_MEASUREMENT_CONFIRMED', 'PARCEL_DELIVERY_CONFIRMED')
         )
       ORDER BY pe.occurred_at ASC`,
      [req.params.id]
    );

    const sla_hours = rows[0]?.sla_hours ? parseInt(rows[0].sla_hours) : 4;
    const sla_ms    = sla_hours * 60 * 60 * 1000;

    const parcels = rows.map(p => {
      const arrived  = new Date(p.arrived_at).getTime();
      const now      = Date.now();
      const elapsed  = now - arrived;
      const deadline = new Date(arrived + sla_ms);

      let sla_status: string;
      if (elapsed > sla_ms)             sla_status = 'BREACHED';
      else if (elapsed > sla_ms * 0.75) sla_status = 'APPROACHING';
      else                              sla_status = 'WITHIN';

      return {
        parcel_id:         p.parcel_id,
        booking_reference: p.booking_reference,
        sender_name:       p.sender_name,
        item_category:     p.item_category,
        declared_weight_kg: p.declared_weight_kg,
        declared_dims: {
          l: p.declared_length_cm,
          w: p.declared_width_cm,
          h: p.declared_height_cm,
        },
        arrived_at:      p.arrived_at,
        minutes_waiting: Math.floor(p.minutes_waiting),
        sla_status,
        sla_deadline:    deadline.toISOString(),
      };
    });

    const summary = {
      total_pending:   parcels.length,
      within_sla:      parcels.filter(p => p.sla_status === 'WITHIN').length,
      approaching_sla: parcels.filter(p => p.sla_status === 'APPROACHING').length,
      breached_sla:    parcels.filter(p => p.sla_status === 'BREACHED').length,
    };

    res.json({
      success: true,
      data: {
        office_id:    req.params.id,
        generated_at: new Date().toISOString(),
        summary,
        parcels,
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
// GET /offices/:id/packing-queue
// Parcels ready to pack — measurement done, payment confirmed
// ================================================================
router.get('/packing-queue', authenticate, async (req: any, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         p.parcel_id, p.booking_reference,
         p.confirmed_weight_kg, p.confirmed_length_cm,
         p.confirmed_width_cm, p.confirmed_height_cm,
         p.confirmed_price, p.item_category,
         p.dest_office_id,
         o.name as dest_office_name, o.region as dest_region
       FROM parcels p
       JOIN offices o ON o.office_id = p.dest_office_id
       WHERE p.origin_office_id = $1
         AND p.confirmed_weight_kg IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM box_parcel_assignments
           WHERE parcel_id = p.parcel_id
         )
         AND NOT EXISTS (
           SELECT 1 FROM parcel_events
           WHERE parcel_id = p.parcel_id
           AND event_type IN ('PARCEL_DELIVERY_CONFIRMED','PARCEL_CANCELLED')
         )
       ORDER BY p.created_at ASC`,
      [req.params.id]
    );

    res.json({ success: true, data: rows });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
// GET /offices/:id/dispatch-queue
// Sealed boxes ready to hand to courier
// ================================================================
router.get('/dispatch-queue', authenticate, async (req: any, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         b.box_id, b.box_serial, b.size_class,
         COUNT(bpa.parcel_id) as parcel_count,
         r.departure_schedules, r.transport_type,
         o.name as dest_office_name
       FROM boxes b
       JOIN box_parcel_assignments bpa ON bpa.box_id = b.box_id AND bpa.removed_at IS NULL
       JOIN parcels p ON p.parcel_id = bpa.parcel_id
       JOIN intercity_routes r ON r.origin_office_id = $1 AND r.dest_office_id = p.dest_office_id
       JOIN offices o ON o.office_id = p.dest_office_id
       WHERE b.status = 'LOADED'
         AND b.current_office_id = $1
       GROUP BY b.box_id, b.box_serial, b.size_class, r.departure_schedules, r.transport_type, o.name
       ORDER BY b.updated_at ASC`,
      [req.params.id]
    );

    res.json({ success: true, data: rows });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
// GET /offices/:id/inbound — What is coming to this office
// ================================================================
router.get('/inbound', authenticate, async (req: any, res) => {
  try {
    // Riders en route to office with parcels
    const { rows: riders } = await db.query(
      `SELECT
         r.rider_id, u.full_name as rider_name,
         r.current_lat, r.current_lng,
         p.parcel_id, p.booking_reference
       FROM riders r
       JOIN app_users u ON u.user_id = r.user_id
       JOIN parcels p ON p.origin_office_id = $1
       WHERE r.assigned_office_id = $1
         AND r.is_online = true
         AND EXISTS (
           SELECT 1 FROM parcel_events
           WHERE parcel_id = p.parcel_id
           AND event_type = 'PARCEL_COLLECTED_BY_RIDER'
         )
         AND NOT EXISTS (
           SELECT 1 FROM parcel_events
           WHERE parcel_id = p.parcel_id
           AND event_type = 'PARCEL_OFFICE_RECEIVED'
         )`,
      [req.params.id]
    );

    // Intercity boxes in transit to this office
    const { rows: boxes } = await db.query(
      `SELECT
         b.box_id, b.box_serial, b.size_class,
         b.last_seen_lat, b.last_seen_lng, b.last_seen_at, b.battery_pct,
         COUNT(bpa.parcel_id) as parcel_count
       FROM boxes b
       JOIN box_parcel_assignments bpa ON bpa.box_id = b.box_id
       JOIN parcels p ON p.parcel_id = bpa.parcel_id AND p.dest_office_id = $1
       WHERE b.status = 'IN_TRANSIT'
       GROUP BY b.box_id, b.box_serial, b.size_class, b.last_seen_lat, b.last_seen_lng, b.last_seen_at, b.battery_pct`,
      [req.params.id]
    );

    res.json({
      success: true,
      data: { inbound_riders: riders, inbound_boxes: boxes }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;