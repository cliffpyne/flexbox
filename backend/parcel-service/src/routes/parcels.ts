import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { redis } from '../redis';
import { authenticate, requireRole, optionalAuth } from '../middleware';
import { publishEvent, scheduleMessage } from '../qstash';
import { generateBookingReference, calculateBillableWeight, calculatePrice, calculateDeposit } from '../utils';
import { rebuildProjection } from '../projection';
import { UserRole } from '@flexbox/types';
import { SLA } from '@flexbox/constants';

const router = Router();

console.log('OFFICE_SERVICE_URL:', process.env.OFFICE_SERVICE_URL);
console.log('ROUTING_SERVICE_URL:', process.env.ROUTING_SERVICE_URL);

// ================================================================
// POST /parcels — Create a booking
// ================================================================
router.post('/',
  authenticate,
  requireRole(UserRole.CUSTOMER, UserRole.AGENT, UserRole.OPS_ADMIN),
  async (req: any, res) => {
    try {
      const body = z.object({
        receiver_phone:       z.string().min(10),
        pickup_gps:           z.object({ lat: z.number(), lng: z.number() }),
        delivery_gps:         z.object({ lat: z.number(), lng: z.number() }),
        item_category:        z.enum(['DOCUMENTS','ELECTRONICS','CLOTHING','FOOD','FRAGILE','MACHINERY','COSMETICS','BOOKS','OTHER']),
        is_fragile:           z.boolean().default(false),
        is_high_value:        z.boolean().default(false),
        declared_value:       z.number().nullable().optional(),
        declared_weight_kg:   z.number().positive(),
        declared_length_cm:   z.number().positive(),
        declared_width_cm:    z.number().positive(),
        declared_height_cm:   z.number().positive(),
        origin_preference:    z.enum(['A1','A2','A3']),
        last_mile_preference: z.enum(['D1','D2']),
        express:              z.boolean().default(false),
        special_protection:   z.boolean().default(false),
        payment_phone:        z.string().min(10),
        payment_provider:     z.enum(['MPESA','TIGO_PESA','AIRTEL_MONEY','HALOPESA']),
        idempotency_key:      z.string().min(10),
      }).parse(req.body);

      // Idempotency check — prevent duplicate bookings on retry
      const { rows: [existing] } = await db.query(
        `SELECT parcel_id FROM parcels
         WHERE sender_id=$1
         AND created_at > NOW() - INTERVAL '10 minutes'
         AND booking_reference IN (
           SELECT booking_reference FROM parcels
           WHERE sender_id=$1
           ORDER BY created_at DESC LIMIT 1
         )`,
        [req.actor.user_id]
      );

      // Step 1 — Resolve origin office from GPS
      const officeServiceUrl = process.env.OFFICE_SERVICE_URL || 'http://localhost:3004';
      const originRes = await fetch(
        `${officeServiceUrl}/offices/serving?lat=${body.pickup_gps.lat}&lng=${body.pickup_gps.lng}&type=PICKUP`,
        { headers: { Authorization: req.headers.authorization || '' } }
      );
      const originData = await originRes.json() as any;
      if (!originData.data?.covered) {
        return res.status(400).json({ success: false, message: 'No FlexSend coverage at pickup location' });
      }

      // Step 2 — Resolve dest office from GPS
      const destRes = await fetch(
        `${officeServiceUrl}/offices/serving?lat=${body.delivery_gps.lat}&lng=${body.delivery_gps.lng}&type=DELIVERY`,
        { headers: { Authorization: req.headers.authorization || '' } }
      );
      const destData = await destRes.json() as any;
      if (!destData.data?.covered) {
        return res.status(400).json({ success: false, message: 'No FlexSend coverage at delivery location' });
      }

      const origin_office_id = originData.data.office_id;
      const dest_office_id   = destData.data.office_id;

      // Step 3 — Determine universe
      const { rows: [originOffice] } = await db.query('SELECT region FROM offices WHERE office_id=$1', [origin_office_id]);
      const { rows: [destOffice] }   = await db.query('SELECT region FROM offices WHERE office_id=$1', [dest_office_id]);
      const universe = originOffice.region === destOffice.region ? 'IN_REGION' : 'UPCOUNTRY';

      // Step 4 — Get route code from Routing Service
      const routingServiceUrl = process.env.ROUTING_SERVICE_URL || 'http://localhost:3003';
      const routeRes = await fetch(`${routingServiceUrl}/routes/assign`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization || '' },
        body: JSON.stringify({
          origin_office_id,
          dest_office_id,
          origin_capabilities:    originData.data.capabilities,
          dest_capabilities:      destData.data.capabilities,
          origin_preference:      body.origin_preference,
          last_mile_preference:   body.last_mile_preference,
          universe,
          is_fragile:             body.is_fragile,
          express:                body.express,
          special_protection:     body.special_protection,
        }),
      });
      const routeData = await routeRes.json() as any;
      if (!routeData.success) {
        return res.status(400).json({ success: false, message: 'PARCEL_002: Invalid route combination for these offices' });
      }

      const { route_code, active_levels } = routeData.data;

      // Step 5 — Calculate price
      const billable = calculateBillableWeight(
        body.declared_weight_kg,
        body.declared_length_cm,
        body.declared_width_cm,
        body.declared_height_cm
      );
      const { min, max } = calculatePrice(billable, universe, route_code);
      const deposit       = calculateDeposit(min);

      // Step 6 — Create parcel record
      const booking_reference = await generateBookingReference();

      const { rows: [parcel] } = await db.query(
        `INSERT INTO parcels (
          booking_reference, sender_id, receiver_phone,
          origin_office_id, dest_office_id, route_code, universe,
          item_category, is_fragile, is_high_value, declared_value,
          declared_weight_kg, declared_length_cm, declared_width_cm, declared_height_cm,
          estimated_price, deposit_amount,
          pickup_lat, pickup_lng, delivery_lat, delivery_lng
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
        ) RETURNING *`,
        [
          booking_reference, req.actor.user_id, body.receiver_phone,
          origin_office_id, dest_office_id, route_code, universe,
          body.item_category, body.is_fragile, body.is_high_value, body.declared_value,
          body.declared_weight_kg, body.declared_length_cm, body.declared_width_cm, body.declared_height_cm,
          min, deposit,
          body.pickup_gps.lat, body.pickup_gps.lng, body.delivery_gps.lat, body.delivery_gps.lng,
        ]
      );

      // Step 7 — Append PARCEL_CREATED event
      const event = {
        parcel_id:    parcel.parcel_id,
        event_type:   'PARCEL_CREATED',
        event_version: 1,
        actor_type:   req.actor.role === 'AGENT' ? 'AGENT' : 'CUSTOMER',
        actor_id:     req.actor.user_id,
        office_id:    origin_office_id,
        payload: {
          route_code, universe, active_levels,
          origin_office_id, dest_office_id,
          booking_reference,
          declared_weight_kg: body.declared_weight_kg,
          estimated_price_min: min,
          estimated_price_max: max,
          deposit_amount: deposit,
        },
        gps_lat:    body.pickup_gps.lat,
        gps_lng:    body.pickup_gps.lng,
        occurred_at: new Date().toISOString(),
      };

      await db.query(
        `INSERT INTO parcel_events
           (parcel_id, event_type, event_version, actor_type, actor_id, office_id,
            payload, gps_lat, gps_lng, occurred_at, recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
        [
          parcel.parcel_id, event.event_type, event.event_version,
          event.actor_type, event.actor_id, event.office_id,
          JSON.stringify(event.payload),
          event.gps_lat, event.gps_lng, event.occurred_at,
        ]
      );

      // Step 8 — Rebuild projection
      await rebuildProjection(event, parcel);

      // Step 9 — Publish to QStash
      await publishEvent('parcel.created', { ...event, service: 'parcel-service' });

      // Schedule pickup SLA check
      await scheduleMessage('parcel.sla_check', {
        parcel_id: parcel.parcel_id, level: 'L1', check_type: 'PICKUP_SLA'
      }, SLA.PICKUP_WINDOW_SECS);

      res.status(201).json({
        success: true,
        data: {
          parcel_id:           parcel.parcel_id,
          booking_reference,
          route_code,
          active_levels,
          universe,
          estimated_price_min: min,
          estimated_price_max: max,
          deposit_amount:      deposit,
          origin_office_id,
          dest_office_id,
        }
      });
    } catch (err: any) {
      console.error(err);
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ================================================================
// GET /parcels/track/:bookingRef — Public tracking (no auth)
// Reads from Redis — never hits DB
// ================================================================
router.get('/track/:bookingRef', async (req, res) => {
  try {
    const { rows: [parcel] } = await db.query(
      'SELECT parcel_id FROM parcels WHERE booking_reference=$1',
      [req.params.bookingRef]
    );
    if (!parcel) return res.status(404).json({ success: false, message: 'Parcel not found' });

    const cached = await redis.get(`parcel:${parcel.parcel_id}:tracking`);
    if (!cached) return res.status(404).json({ success: false, message: 'Tracking not available yet' });

    res.json({ success: true, data: JSON.parse(cached) });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
// GET /parcels/:id — Full parcel detail + projection
// ================================================================
router.get('/:id', authenticate, async (req: any, res) => {
  try {
    const { rows: [parcel] } = await db.query(
      `SELECT p.*,
         o1.name as origin_office_name, o1.office_code as origin_office_code,
         o2.name as dest_office_name,   o2.office_code as dest_office_code
       FROM parcels p
       LEFT JOIN offices o1 ON o1.office_id = p.origin_office_id
       LEFT JOIN offices o2 ON o2.office_id = p.dest_office_id
       WHERE p.parcel_id=$1`,
      [req.params.id]
    );
    if (!parcel) return res.status(404).json({ success: false, message: 'PARCEL_001: Not found' });

    // Authorization — customers can only see own parcels
    if (req.actor.role === UserRole.CUSTOMER && parcel.sender_id !== req.actor.user_id) {
      return res.status(403).json({ success: false, message: 'AUTH_008: Not your parcel' });
    }

    const cached = await redis.get(`parcel:${parcel.parcel_id}:projection`);
    const projection = cached ? JSON.parse(cached) : null;

    res.json({ success: true, data: { parcel, projection } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
// GET /parcels — List parcels (mine or office)
// ================================================================
router.get('/', authenticate, async (req: any, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let where = '';
    let params: any[] = [];

    if (req.actor.role === UserRole.CUSTOMER) {
      where = 'WHERE p.sender_id=$1';
      params = [req.actor.user_id];
    } else if (req.actor.role === UserRole.AGENT) {
      where = 'WHERE p.sender_id=$1';
      params = [req.actor.user_id];
    } else if ([UserRole.OFFICE_WORKER, UserRole.OFFICE_MANAGER].includes(req.actor.role)) {
      where = 'WHERE (p.origin_office_id=$1 OR p.dest_office_id=$1)';
      params = [req.actor.office_id];
    }

    params.push(Number(limit), offset);
    const i = params.length;

    const { rows } = await db.query(
      `SELECT p.parcel_id, p.booking_reference, p.route_code, p.universe,
              p.item_category, p.estimated_price, p.confirmed_price,
              p.deposit_amount, p.created_at,
              o1.name as origin_office, o2.name as dest_office
       FROM parcels p
       LEFT JOIN offices o1 ON o1.office_id = p.origin_office_id
       LEFT JOIN offices o2 ON o2.office_id = p.dest_office_id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT $${i - 1} OFFSET $${i}`,
      params
    );

    res.json({ success: true, data: rows, page: Number(page), limit: Number(limit) });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
// GET /parcels/:id/events — Full event history (support console)
// ================================================================
router.get('/:id/events',
  authenticate,
  requireRole(UserRole.SUPPORT_AGENT, UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN, UserRole.OFFICE_MANAGER),
  async (req: any, res) => {
    try {
      const { rows } = await db.query(
        `SELECT pe.*,
           u.full_name as actor_name, u.role as actor_role_name
         FROM parcel_events pe
         LEFT JOIN app_users u ON u.user_id = pe.actor_id
         WHERE pe.parcel_id=$1
         ORDER BY pe.sequence_number ASC`,
        [req.params.id]
      );
      res.json({ success: true, data: rows });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

export default router;