import { Router }    from 'express';
import { z }         from 'zod';
import { db }        from '../db';
import { redis }     from '../redis';
import { authenticate, requireRole, requireSameOffice } from '../middleware';
import { publishEvent }  from '../qstash';
import { startSLA, completeSLA } from '../services/sla.service';
import { calculatePrice }        from '../services/pricing.service';
import { UserRole }  from '@flexbox/types';

const router = Router({ mergeParams: true });

// ─────────────────────────────────────────────────────────────────────────────
// GET /offices/:id/intake-queue
// Real-time list of parcels waiting at this office
// ─────────────────────────────────────────────────────────────────────────────
router.get('/intake-queue', authenticate, requireSameOffice(), async (req: any, res) => {
  try {
    // Try Redis projection first — sub-millisecond
    const cached = await redis.get(`office:${req.params.id}:dashboard`);
    if (cached) {
      const dashboard = JSON.parse(cached);
      return res.json({ success: true, data: dashboard.intake_queue || [] });
    }

    const { rows } = await db.query(
      `SELECT
         p.parcel_id, p.booking_reference,
         u.full_name   as sender_name,
         u.phone       as sender_phone,
         p.item_category,
         p.declared_weight_kg,
         p.declared_length_cm, p.declared_width_cm, p.declared_height_cm,
         p.confirmed_weight_kg,
         pe.occurred_at as arrived_at,
         EXTRACT(EPOCH FROM (NOW() - pe.occurred_at))/60 as minutes_waiting,
         COALESCE(o.sla_config->>'measurement_sla_hours', '2') as sla_hours,
         CASE
           WHEN p.confirmed_weight_kg IS NOT NULL THEN 'MEASURED'
           ELSE 'PENDING_MEASUREMENT'
         END as measurement_status
       FROM parcels p
       JOIN app_users u ON u.user_id = p.sender_id
       JOIN offices o   ON o.office_id = p.origin_office_id
       JOIN LATERAL (
         SELECT occurred_at FROM parcel_events
         WHERE parcel_id = p.parcel_id
           AND event_type = 'PARCEL_OFFICE_RECEIVED'
         ORDER BY sequence_number DESC LIMIT 1
       ) pe ON true
       WHERE p.origin_office_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM parcel_events
           WHERE parcel_id = p.parcel_id
             AND event_type IN (
               'PARCEL_PACKED', 'PARCEL_DELIVERY_CONFIRMED',
               'PARCEL_CANCELLED', 'PARCEL_HANDED_TO_COURIER'
             )
         )
       ORDER BY pe.occurred_at ASC`,
      [req.params.id]
    );

    const parcels = rows.map(p => {
      const sla_ms  = parseInt(p.sla_hours) * 3600_000;
      const arrived = new Date(p.arrived_at).getTime();
      const elapsed = Date.now() - arrived;
      const sla_pct = Math.min((elapsed / sla_ms) * 100, 100);

      return {
        ...p,
        minutes_waiting: Math.floor(p.minutes_waiting),
        sla_pct:         Math.round(sla_pct),
        sla_status:
          sla_pct >= 100 ? 'BREACHED'   :
          sla_pct >= 75  ? 'APPROACHING' : 'WITHIN',
        sla_deadline: new Date(arrived + sla_ms).toISOString(),
      };
    });

    res.json({
      success: true,
      data: {
        office_id:    req.params.id,
        generated_at: new Date().toISOString(),
        summary: {
          total:       parcels.length,
          within:      parcels.filter(p => p.sla_status === 'WITHIN').length,
          approaching: parcels.filter(p => p.sla_status === 'APPROACHING').length,
          breached:    parcels.filter(p => p.sla_status === 'BREACHED').length,
        },
        parcels,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /offices/:id/parcels/:parcelId/measure
// Office worker confirms parcel weight and dimensions
// No photo required — variance triggers repricing automatically
// ─────────────────────────────────────────────────────────────────────────────
router.post('/parcels/:parcelId/measure',
  authenticate,
  requireRole(UserRole.OFFICE_WORKER, UserRole.OFFICE_MANAGER, UserRole.OPS_ADMIN),
  requireSameOffice(),
  async (req: any, res) => {
    try {
      const body = z.object({
        confirmed_weight_kg: z.number().positive(),
        confirmed_length_cm: z.number().positive(),
        confirmed_width_cm:  z.number().positive(),
        confirmed_height_cm: z.number().positive(),
        occurred_at:         z.string().datetime().optional(),
      }).parse(req.body);

      // Get parcel
      const { rows: [parcel] } = await db.query(
        `SELECT * FROM parcels WHERE parcel_id = $1 AND origin_office_id = $2`,
        [req.params.parcelId, req.params.id]
      );
      if (!parcel) {
        return res.status(404).json({ success: false, message: 'Parcel not found at this office' });
      }
      if (parcel.confirmed_weight_kg) {
        return res.status(409).json({ success: false, message: 'Parcel already measured' });
      }

      // Calculate variance
      const variance_pct = Math.abs(
        (body.confirmed_weight_kg - parcel.declared_weight_kg) / parcel.declared_weight_kg
      ) * 100;

      // Calculate new price with confirmed dimensions
      const newPrice = await calculatePrice({
        declared_weight_kg: body.confirmed_weight_kg,
        declared_length_cm: body.confirmed_length_cm,
        declared_width_cm:  body.confirmed_width_cm,
        declared_height_cm: body.confirmed_height_cm,
        category:           parcel.item_category,
        is_fragile:         parcel.is_fragile,
        origin_office_id:   parcel.origin_office_id,
        dest_office_id:     parcel.dest_office_id,
      });

      const price_diff    = newPrice.final_price - (parcel.deposit_amount || parcel.estimated_price);
      const repricing     = variance_pct > 10;
      const fraud_flag    = variance_pct > 20;
      const occurred_at   = body.occurred_at ?? new Date().toISOString();

      // DB write: update parcel with confirmed dims
      await db.query(
        `UPDATE parcels SET
           confirmed_weight_kg = $1,
           confirmed_length_cm = $2,
           confirmed_width_cm  = $3,
           confirmed_height_cm = $4,
           confirmed_price     = $5,
           updated_at          = NOW()
         WHERE parcel_id = $6`,
        [
          body.confirmed_weight_kg, body.confirmed_length_cm,
          body.confirmed_width_cm,  body.confirmed_height_cm,
          newPrice.final_price,     req.params.parcelId,
        ]
      );

      // Append parcel event
      const { rows: [{ max: maxSeq }] } = await db.query(
        'SELECT MAX(sequence_number) FROM parcel_events WHERE parcel_id = $1',
        [req.params.parcelId]
      );
      await db.query(
        `INSERT INTO parcel_events
           (parcel_id, event_type, sequence_number, actor_id, actor_role, occurred_at, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.params.parcelId,
          fraud_flag ? 'PARCEL_FRAUD_FLAG' : 'PARCEL_MEASUREMENT_CONFIRMED',
          (maxSeq ?? 0) + 1,
          req.actor.user_id, req.actor.role, occurred_at,
          JSON.stringify({
            confirmed_weight_kg: body.confirmed_weight_kg,
            declared_weight_kg:  parcel.declared_weight_kg,
            variance_pct:        Math.round(variance_pct * 10) / 10,
            repricing_triggered: repricing,
            fraud_flag,
            price_diff,
            new_price:           newPrice.final_price,
            price_breakdown:     newPrice,
          }),
        ]
      );

      // Cancel MEASUREMENT SLA timer
      await completeSLA(req.params.parcelId, 'MEASUREMENT');

      // Publish event
      await publishEvent(fraud_flag ? 'parcel.fraud_flag' : 'parcel.measurement_confirmed', {
        parcel_id:           req.params.parcelId,
        office_id:           req.params.id,
        confirmed_weight_kg: body.confirmed_weight_kg,
        variance_pct:        Math.round(variance_pct * 10) / 10,
        repricing_triggered: repricing,
        fraud_flag,
        price_diff,
        new_price:           newPrice.final_price,
        occurred_at,
        service:             'office-service',
      });

      // Start PACKING SLA (only if not fraud flagged)
      if (!fraud_flag) {
        await startSLA({
          parcel_id: req.params.parcelId,
          sla_type:  'PACKING',
          office_id: req.params.id,
        });
      }

      res.json({
        success: true,
        data: {
          parcel_id:           req.params.parcelId,
          variance_pct:        Math.round(variance_pct * 10) / 10,
          repricing_triggered: repricing,
          fraud_flag,
          price_diff,
          new_price:           newPrice.final_price,
          price_breakdown:     newPrice,
          message:
            fraud_flag    ? 'Parcel held — variance >20%. Ops Admin notified.' :
            repricing     ? `Repricing triggered. Customer owes ${price_diff > 0 ? '+' : ''}TZS ${price_diff.toLocaleString()}` :
                            'Measurement confirmed. Parcel ready for packing.',
        },
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /offices/:id/packing-queue
// Parcels measured and ready to be assigned to a box
// ─────────────────────────────────────────────────────────────────────────────
router.get('/packing-queue', authenticate, requireSameOffice(), async (req: any, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         p.parcel_id, p.booking_reference,
         p.confirmed_weight_kg,
         p.confirmed_length_cm, p.confirmed_width_cm, p.confirmed_height_cm,
         p.confirmed_price,
         p.item_category, p.is_fragile,
         p.dest_office_id,
         o.name   as dest_office_name,
         o.region as dest_region
       FROM parcels p
       JOIN offices o ON o.office_id = p.dest_office_id
       WHERE p.origin_office_id = $1
         AND p.confirmed_weight_kg IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM box_parcel_assignments WHERE parcel_id = p.parcel_id
         )
         AND NOT EXISTS (
           SELECT 1 FROM parcel_events
           WHERE parcel_id = p.parcel_id
             AND event_type IN (
               'PARCEL_DELIVERY_CONFIRMED', 'PARCEL_CANCELLED', 'PARCEL_FRAUD_FLAG'
             )
         )
       ORDER BY p.is_fragile DESC, p.confirmed_weight_kg DESC`,
      [req.params.id]
    );

    // Get available boxes at this office with remaining capacity
    const { rows: boxes } = await db.query(
      `SELECT
         b.box_id, b.box_serial, b.size_class,
         b.max_weight_kg,
         COALESCE(used.total_weight, 0)   as used_weight_kg,
         b.max_weight_kg - COALESCE(used.total_weight, 0) as remaining_weight_kg,
         COALESCE(used.parcel_count, 0) as parcel_count
       FROM boxes b
       LEFT JOIN (
         SELECT bpa.box_id,
                SUM(p.confirmed_weight_kg) as total_weight,
                COUNT(bpa.parcel_id) as parcel_count
         FROM box_parcel_assignments bpa
         JOIN parcels p ON p.parcel_id = bpa.parcel_id
         WHERE bpa.removed_at IS NULL
         GROUP BY bpa.box_id
       ) used ON used.box_id = b.box_id
       WHERE b.current_office_id = $1
         AND b.status = 'AVAILABLE'
       ORDER BY remaining_weight_kg DESC`,
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        parcels_to_pack: rows,
        available_boxes: boxes,
        total_pending:   rows.length,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /offices/:id/pack
// Assign parcels to a box and seal it
// ─────────────────────────────────────────────────────────────────────────────
router.post('/pack',
  authenticate,
  requireRole(UserRole.OFFICE_WORKER, UserRole.OFFICE_MANAGER, UserRole.OPS_ADMIN),
  requireSameOffice(),
  async (req: any, res) => {
    try {
      const body = z.object({
        box_id:     z.string().uuid(),
        parcel_ids: z.array(z.string().uuid()).min(1),
      }).parse(req.body);

      // Verify box exists at this office and is available
      const { rows: [box] } = await db.query(
        `SELECT * FROM boxes WHERE box_id = $1 AND current_office_id = $2 AND status = 'AVAILABLE'`,
        [body.box_id, req.params.id]
      );
      if (!box) {
        return res.status(404).json({ success: false, message: 'Box not found or not available' });
      }

      // Verify all parcels belong to this office and are ready
      const { rows: parcels } = await db.query(
        `SELECT parcel_id, confirmed_weight_kg, is_fragile, dest_office_id
         FROM parcels
         WHERE parcel_id = ANY($1::uuid[])
           AND origin_office_id = $2
           AND confirmed_weight_kg IS NOT NULL`,
        [body.parcel_ids, req.params.id]
      );

      if (parcels.length !== body.parcel_ids.length) {
        return res.status(400).json({
          success: false,
          message: 'Some parcels not found, not at this office, or not yet measured',
        });
      }

      // Check weight capacity
      const totalWeight = parcels.reduce((sum, p) => sum + parseFloat(p.confirmed_weight_kg), 0);
      if (totalWeight > box.max_weight_kg) {
        return res.status(400).json({
          success: false,
          message: `Total weight ${totalWeight}kg exceeds box capacity ${box.max_weight_kg}kg`,
        });
      }

      // DB: assign all parcels to box
      for (const parcel of parcels) {
        await db.query(
          `INSERT INTO box_parcel_assignments (box_id, parcel_id, assigned_by, assigned_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (parcel_id) DO UPDATE SET box_id = $1, assigned_by = $3, assigned_at = NOW()`,
          [body.box_id, parcel.parcel_id, req.actor.user_id]
        );
      }

      // Update box status to LOADED
      await db.query(
        `UPDATE boxes SET status = 'LOADED', updated_at = NOW() WHERE box_id = $1`,
        [body.box_id]
      );

      // Append PARCEL_PACKED event for each parcel
      for (const parcel of parcels) {
        const { rows: [{ max: maxSeq }] } = await db.query(
          'SELECT MAX(sequence_number) FROM parcel_events WHERE parcel_id = $1',
          [parcel.parcel_id]
        );
        await db.query(
          `INSERT INTO parcel_events
             (parcel_id, event_type, sequence_number, actor_id, actor_role, occurred_at, payload)
           VALUES ($1, 'PARCEL_PACKED', $2, $3, $4, NOW(), $5)`,
          [
            parcel.parcel_id, (maxSeq ?? 0) + 1,
            req.actor.user_id, req.actor.role,
            JSON.stringify({ box_id: body.box_id, box_serial: box.box_serial }),
          ]
        );

        // Cancel PACKING SLA, start DISPATCH SLA
        await completeSLA(parcel.parcel_id, 'PACKING');
        await startSLA({ parcel_id: parcel.parcel_id, sla_type: 'DISPATCH', office_id: req.params.id });
      }

      await publishEvent('parcel.packed', {
        box_id:      body.box_id,
        box_serial:  box.box_serial,
        parcel_ids:  body.parcel_ids,
        office_id:   req.params.id,
        packed_by:   req.actor.user_id,
        timestamp:   new Date().toISOString(),
        service:     'office-service',
      });

      res.json({
        success: true,
        data: {
          box_id:       body.box_id,
          box_serial:   box.box_serial,
          parcel_count: parcels.length,
          total_weight: totalWeight,
          status:       'LOADED',
          message:      `${parcels.length} parcels packed into ${box.box_serial}`,
        },
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /offices/:id/dispatch-queue
// Loaded boxes ready to hand to transporter
// ─────────────────────────────────────────────────────────────────────────────
router.get('/dispatch-queue', authenticate, requireSameOffice(), async (req: any, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         b.box_id, b.box_serial, b.size_class,
         COUNT(bpa.parcel_id)       as parcel_count,
         SUM(p.confirmed_weight_kg) as total_weight_kg,
         o.name   as dest_office_name,
         o.region as dest_region,
         r.estimated_hours          as route_transit_hours
       FROM boxes b
       JOIN box_parcel_assignments bpa ON bpa.box_id = b.box_id AND bpa.removed_at IS NULL
       JOIN parcels p ON p.parcel_id = bpa.parcel_id
       JOIN offices o ON o.office_id = p.dest_office_id
       LEFT JOIN intercity_routes r
         ON r.origin_office_id = $1 AND r.dest_office_id = p.dest_office_id AND r.is_active = true
       WHERE b.status = 'LOADED' AND b.current_office_id = $1
       GROUP BY b.box_id, b.box_serial, b.size_class, o.name, o.region, r.estimated_hours
       ORDER BY b.updated_at ASC`,
      [req.params.id]
    );

    res.json({ success: true, data: rows });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /offices/:id/inbound
// Riders en route + boxes in transit heading to this office
// ─────────────────────────────────────────────────────────────────────────────
router.get('/inbound', authenticate, requireSameOffice(), async (req: any, res) => {
  try {
    const { rows: riders } = await db.query(
      `SELECT
         r.rider_id, u.full_name as rider_name, u.phone as rider_phone,
         r.current_lat, r.current_lng,
         p.parcel_id, p.booking_reference
       FROM riders r
       JOIN app_users u ON u.user_id = r.user_id
       JOIN parcels p   ON p.origin_office_id = $1
       WHERE r.assigned_office_id = $1 AND r.is_online = true
         AND EXISTS (
           SELECT 1 FROM parcel_events
           WHERE parcel_id = p.parcel_id AND event_type = 'PARCEL_COLLECTED_BY_RIDER'
         )
         AND NOT EXISTS (
           SELECT 1 FROM parcel_events
           WHERE parcel_id = p.parcel_id AND event_type = 'PARCEL_OFFICE_RECEIVED'
         )`,
      [req.params.id]
    );

    const { rows: boxes } = await db.query(
      `SELECT
         b.box_id, b.box_serial, b.size_class,
         b.last_seen_lat, b.last_seen_lng, b.last_seen_at, b.battery_pct,
         COUNT(bpa.parcel_id)  as parcel_count,
         tt.estimated_arrival,
         tt.driver_name, tt.driver_phone, tt.plate_number
       FROM boxes b
       JOIN box_parcel_assignments bpa ON bpa.box_id = b.box_id
       JOIN parcels p ON p.parcel_id = bpa.parcel_id AND p.dest_office_id = $1
       LEFT JOIN transporter_trips tt ON tt.box_id = b.box_id AND tt.status = 'IN_TRANSIT'
       WHERE b.status = 'IN_TRANSIT'
       GROUP BY b.box_id, b.box_serial, b.size_class,
                b.last_seen_lat, b.last_seen_lng, b.last_seen_at, b.battery_pct,
                tt.estimated_arrival, tt.driver_name, tt.driver_phone, tt.plate_number`,
      [req.params.id]
    );

    res.json({ success: true, data: { inbound_riders: riders, inbound_boxes: boxes } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /offices/:id/walkin
// Office worker books a parcel on behalf of a walk-in customer
// Same flow as customer booking but commission = 0, tagged WALK_IN
// ─────────────────────────────────────────────────────────────────────────────
router.post('/walkin',
  authenticate,
  requireRole(UserRole.OFFICE_WORKER, UserRole.OFFICE_MANAGER, UserRole.OPS_ADMIN),
  requireSameOffice(),
  async (req: any, res) => {
    try {
      const body = z.object({
        customer_name:       z.string().min(2),
        customer_phone:      z.string().min(10),
        receiver_name:       z.string().min(2),
        receiver_phone:      z.string().min(10),
        receiver_address:    z.string().min(5),
        receiver_gps:        z.object({ lat: z.number(), lng: z.number() }),
        declared_weight_kg:  z.number().positive(),
        declared_length_cm:  z.number().positive(),
        declared_width_cm:   z.number().positive(),
        declared_height_cm:  z.number().positive(),
        category:            z.enum(['DOCUMENTS','ELECTRONICS','CLOTHING','FOOD','FRAGILE','OTHER']),
        is_fragile:          z.boolean().default(false),
        declared_value:      z.number().nonnegative().default(0),
        payment_method:      z.enum(['MPESA','TIGO','AIRTEL','HALOPESA','CASH']),
      }).parse(req.body);

      // Get or create customer account
      let { rows: [customer] } = await db.query(
        'SELECT user_id FROM app_users WHERE phone = $1',
        [body.customer_phone]
      );
      if (!customer) {
        const { rows: [newCustomer] } = await db.query(
          `INSERT INTO app_users (phone, full_name, role, is_verified, is_active)
           VALUES ($1, $2, 'CUSTOMER', true, true) RETURNING user_id`,
          [body.customer_phone, body.customer_name]
        );
        customer = newCustomer;
      }

      // Find destination office from receiver GPS
      const { rows: [destOffice] } = await db.query(
        `SELECT o.office_id FROM offices o
         JOIN office_coverage_zones z ON z.office_id = o.office_id
         WHERE o.status = 'ACTIVE'
           AND z.zone_type = 'DELIVERY'
           AND z.is_active = true
           AND ST_Within(
             ST_SetSRID(ST_MakePoint($1, $2), 4326), z.polygon
           )
         ORDER BY CASE o.office_type WHEN 'HUB' THEN 1 WHEN 'BRANCH' THEN 2 ELSE 3 END
         LIMIT 1`,
        [body.receiver_gps.lng, body.receiver_gps.lat]
      );
      if (!destOffice) {
        return res.status(400).json({
          success: false,
          message: 'No FlexSend coverage at the receiver location',
        });
      }

      // Calculate price
      const price = await calculatePrice({
        declared_weight_kg: body.declared_weight_kg,
        declared_length_cm: body.declared_length_cm,
        declared_width_cm:  body.declared_width_cm,
        declared_height_cm: body.declared_height_cm,
        category:           body.category,
        is_fragile:         body.is_fragile,
        origin_office_id:   req.params.id,
        dest_office_id:     destOffice.office_id,
      });

      // Generate booking reference
      const { rows: [refRow] } = await db.query(
        "SELECT 'TZ-' || LPAD(nextval('booking_ref_seq')::text, 5, '0') as ref"
      );

      // Create parcel
      const { rows: [parcel] } = await db.query(
        `INSERT INTO parcels (
           booking_reference, sender_id, origin_office_id, dest_office_id,
           receiver_name, receiver_phone, receiver_address, receiver_gps,
           declared_weight_kg, declared_length_cm, declared_width_cm, declared_height_cm,
           item_category, is_fragile, declared_value,
           estimated_price, deposit_amount,
           booking_type, booked_by, agent_commission_rate
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,ST_SetSRID(ST_MakePoint($8,$9),4326),
           $10,$11,$12,$13,$14,$15,$16,$17,$17,'WALK_IN',$18,0
         ) RETURNING parcel_id, booking_reference`,
        [
          refRow.ref, customer.user_id, req.params.id, destOffice.office_id,
          body.receiver_name, body.receiver_phone, body.receiver_address,
          body.receiver_gps.lng, body.receiver_gps.lat,
          body.declared_weight_kg, body.declared_length_cm,
          body.declared_width_cm,  body.declared_height_cm,
          body.category, body.is_fragile, body.declared_value,
          price.final_price, req.actor.user_id,
        ]
      );

      // Append parcel.created event
      await db.query(
        `INSERT INTO parcel_events
           (parcel_id, event_type, sequence_number, actor_id, actor_role, occurred_at, payload)
         VALUES ($1, 'PARCEL_CREATED', 1, $2, $3, NOW(), $4)`,
        [
          parcel.parcel_id, req.actor.user_id, req.actor.role,
          JSON.stringify({
            booking_type: 'WALK_IN',
            booked_by:    req.actor.user_id,
            price_breakdown: price,
          }),
        ]
      );

      // Parcel is already at office — append PARCEL_OFFICE_RECEIVED immediately
      await db.query(
        `INSERT INTO parcel_events
           (parcel_id, event_type, sequence_number, actor_id, actor_role, occurred_at, payload)
         VALUES ($1, 'PARCEL_OFFICE_RECEIVED', 2, $2, $3, NOW(), $4)`,
        [
          parcel.parcel_id, req.actor.user_id, req.actor.role,
          JSON.stringify({ walk_in: true, received_at_office: req.params.id }),
        ]
      );

      // Start MEASUREMENT SLA
      await startSLA({
        parcel_id: parcel.parcel_id,
        sla_type:  'MEASUREMENT',
        office_id: req.params.id,
      });

      await publishEvent('parcel.created', {
        parcel_id:        parcel.parcel_id,
        booking_reference: parcel.booking_reference,
        booking_type:     'WALK_IN',
        origin_office_id: req.params.id,
        dest_office_id:   destOffice.office_id,
        price:            price.final_price,
        service:          'office-service',
        timestamp:        new Date().toISOString(),
      });

      res.status(201).json({
        success: true,
        data: {
          parcel_id:         parcel.parcel_id,
          booking_reference: parcel.booking_reference,
          price_breakdown:   price,
          message:           'Walk-in parcel created. Proceed to measurement.',
        },
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

export default router;
