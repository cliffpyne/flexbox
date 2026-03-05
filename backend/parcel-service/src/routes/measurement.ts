import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { redis } from '../redis';
import { authenticate, requireRole } from '../middleware';
import { publishEvent, scheduleMessage } from '../qstash';
import { rebuildProjection } from '../projection';
import { calculateBillableWeight, calculateVariancePct } from '../utils';
import { UserRole } from '@flexbox/types';
import { FRAUD, SLA } from '@flexbox/constants';

const router = Router({ mergeParams: true });

// ================================================================
// POST /parcels/:id/measurement — Submit confirmed measurements
// ================================================================
router.post('/',
  authenticate,
  requireRole(UserRole.OFFICE_WORKER, UserRole.OFFICE_MANAGER),
  async (req: any, res) => {
    try {
      const body = z.object({
        confirmed_weight_kg:  z.number().positive(),
        confirmed_length_cm:  z.number().positive(),
        confirmed_width_cm:   z.number().positive(),
        confirmed_height_cm:  z.number().positive(),
        photo_url:            z.string().url(),
        scale_receipt_url:    z.string().url().nullable().optional(),
        occurred_at:          z.string().datetime(),
      }).parse(req.body);

      const { rows: [parcel] } = await db.query(
        'SELECT * FROM parcels WHERE parcel_id=$1',
        [req.params.id]
      );
      if (!parcel) return res.status(404).json({ success: false, message: 'PARCEL_001: Not found' });

      // Only office workers at the origin office can measure
      if (req.actor.office_id !== parcel.origin_office_id) {
        return res.status(403).json({ success: false, message: 'AUTH_008: Not your office parcel' });
      }

      // Calculate variance on weight (primary billing metric)
      const variance_pct = calculateVariancePct(
        parcel.declared_weight_kg,
        body.confirmed_weight_kg
      );

      // Calculate volumetric and billable weight
      const volumetric_weight_kg = (
        body.confirmed_length_cm * body.confirmed_width_cm * body.confirmed_height_cm
      ) / 5000;
      const billable_weight_kg = calculateBillableWeight(
        body.confirmed_weight_kg,
        body.confirmed_length_cm,
        body.confirmed_width_cm,
        body.confirmed_height_cm
      );

      // Simple price recalculation
      const { rows: [office] } = await db.query(
        'SELECT pricing_overrides, region FROM offices WHERE office_id=$1',
        [parcel.origin_office_id]
      );
      const base     = parcel.universe === 'UPCOUNTRY' ? 8000 : 3000;
      const perKg    = parcel.universe === 'UPCOUNTRY' ? 2000 : 800;
      const lmFee    = parcel.route_code.endsWith('D1') ? 2500 : 0;
      const surcharge = office?.pricing_overrides?.local_surcharge_pct
        ? (base * office.pricing_overrides.local_surcharge_pct / 100) : 0;
      const confirmed_price = Math.round(base + (billable_weight_kg * perKg) + lmFee + surcharge);
      const balance_due     = Math.max(0, confirmed_price - parcel.deposit_amount);

      let outcome: string;

      if (variance_pct <= 10) {
        // ── CONFIRMED — within tolerance ────────────────────────
        outcome = 'CONFIRMED';

        // Update parcels row with confirmed measurements
        await db.query(
          `UPDATE parcels SET
             confirmed_weight_kg=$1, confirmed_length_cm=$2,
             confirmed_width_cm=$3,  confirmed_height_cm=$4,
             confirmed_price=$5,     balance_due=$6, updated_at=NOW()
           WHERE parcel_id=$7`,
          [
            body.confirmed_weight_kg, body.confirmed_length_cm,
            body.confirmed_width_cm,  body.confirmed_height_cm,
            confirmed_price, balance_due, parcel.parcel_id,
          ]
        );

        const event = {
          parcel_id:     parcel.parcel_id,
          event_type:    'PARCEL_MEASUREMENT_CONFIRMED',
          event_version: 1,
          actor_type:    'OFFICE_WORKER',
          actor_id:      req.actor.user_id,
          office_id:     parcel.origin_office_id,
          payload: {
            confirmed_weight_kg: body.confirmed_weight_kg,
            confirmed_length_cm: body.confirmed_length_cm,
            confirmed_width_cm:  body.confirmed_width_cm,
            confirmed_height_cm: body.confirmed_height_cm,
            volumetric_weight_kg,
            billable_weight_kg,
            variance_pct,
            confirmed_price,
            balance_due,
            photo_url: body.photo_url,
          },
          occurred_at: body.occurred_at,
        };

        await db.query(
          `INSERT INTO parcel_events
             (parcel_id,event_type,event_version,actor_type,actor_id,office_id,payload,occurred_at,recorded_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
          [event.parcel_id, event.event_type, event.event_version,
           event.actor_type, event.actor_id, event.office_id,
           JSON.stringify(event.payload), event.occurred_at]
        );

        await rebuildProjection(event, parcel);
        await publishEvent('parcel.measurement', { ...event, service: 'parcel-service' });

        return res.json({
          success: true,
          data: {
            outcome,
            declared_weight_kg:  parcel.declared_weight_kg,
            confirmed_weight_kg: body.confirmed_weight_kg,
            variance_pct:        Math.round(variance_pct),
            volumetric_weight_kg,
            billable_weight_kg,
            confirmed_price,
            deposit_already_paid: parcel.deposit_amount,
            balance_due,
          }
        });
      }

      // ── REPRICING TRIGGERED — variance > 10% ────────────────
      outcome = 'REPRICING_TRIGGERED';

      // Flag fraud if > 20%
      let fraud_flagged = false;
      if (variance_pct > 20) {
        fraud_flagged = true;
        await db.query(
          `UPDATE app_users SET
             measurement_mismatch_count = COALESCE(measurement_mismatch_count, 0) + 1,
             updated_at = NOW()
           WHERE user_id = $1`,
          [parcel.sender_id]
        );
      }

      const payment_deadline = new Date(Date.now() + SLA.REPRICE_WINDOW_SECS * 1000).toISOString();

      const event = {
        parcel_id:     parcel.parcel_id,
        event_type:    'PARCEL_REPRICING_TRIGGERED',
        event_version: 1,
        actor_type:    'OFFICE_WORKER',
        actor_id:      req.actor.user_id,
        office_id:     parcel.origin_office_id,
        payload: {
          declared_weight_kg:  parcel.declared_weight_kg,
          confirmed_weight_kg: body.confirmed_weight_kg,
          variance_pct,
          original_price:      parcel.estimated_price,
          new_price:           confirmed_price,
          difference:          confirmed_price - parcel.estimated_price,
          payment_deadline,
          payment_window_mins: SLA.REPRICE_WINDOW_SECS / 60,
          photo_url:           body.photo_url,
          fraud_flagged,
        },
        occurred_at: body.occurred_at,
      };

      await db.query(
        `INSERT INTO parcel_events
           (parcel_id,event_type,event_version,actor_type,actor_id,office_id,payload,occurred_at,recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
        [event.parcel_id, event.event_type, event.event_version,
         event.actor_type, event.actor_id, event.office_id,
         JSON.stringify(event.payload), event.occurred_at]
      );

      await rebuildProjection(event, parcel);
      await publishEvent('parcel.repricing', { ...event, service: 'parcel-service' });

      // Schedule auto-reject after 30 min window if no response
      await scheduleMessage('parcel.repricing_timeout', {
        parcel_id:        parcel.parcel_id,
        check_type:       'REPRICING_TIMEOUT',
        new_price:        confirmed_price,
        confirmed_weight: body.confirmed_weight_kg,
      }, SLA.REPRICE_WINDOW_SECS);

      return res.json({
        success: true,
        data: {
          outcome,
          variance_pct:         Math.round(variance_pct),
          original_price:       parcel.estimated_price,
          new_price:            confirmed_price,
          difference:           confirmed_price - (parcel.estimated_price || 0),
          evidence_photo_url:   body.photo_url,
          payment_deadline,
          payment_window_mins:  SLA.REPRICE_WINDOW_SECS / 60,
          fraud_flagged,
        }
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ================================================================
// POST /parcels/:id/repricing/accept
// ================================================================
router.post('/repricing/accept',
  authenticate,
  requireRole(UserRole.CUSTOMER),
  async (req: any, res) => {
    try {
      const { rows: [parcel] } = await db.query(
        'SELECT * FROM parcels WHERE parcel_id=$1 AND sender_id=$2',
        [req.params.id, req.actor.user_id]
      );
      if (!parcel) return res.status(404).json({ success: false, message: 'PARCEL_001: Not your parcel' });

      // Check repricing deadline from projection
      const cached = await redis.get(`parcel:${parcel.parcel_id}:projection`);
      const projection = cached ? JSON.parse(cached) : null;
      if (projection?.repricing_deadline && new Date(projection.repricing_deadline) < new Date()) {
        return res.status(400).json({ success: false, message: 'Repricing window has expired' });
      }

      const event = {
        parcel_id:     parcel.parcel_id,
        event_type:    'PARCEL_REPRICING_ACCEPTED',
        event_version: 1,
        actor_type:    'CUSTOMER',
        actor_id:      req.actor.user_id,
        office_id:     parcel.origin_office_id,
        payload:       { accepted_at: new Date().toISOString() },
        occurred_at:   new Date().toISOString(),
      };

      await db.query(
        `INSERT INTO parcel_events
           (parcel_id,event_type,event_version,actor_type,actor_id,office_id,payload,occurred_at,recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
        [event.parcel_id, event.event_type, event.event_version,
         event.actor_type, event.actor_id, event.office_id,
         JSON.stringify(event.payload), event.occurred_at]
      );

      await rebuildProjection(event, parcel);
      await publishEvent('parcel.repricing', { ...event, service: 'parcel-service' });

      res.json({ success: true, message: 'Repricing accepted — parcel moved to packing queue' });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ================================================================
// POST /parcels/:id/repricing/reject
// ================================================================
router.post('/repricing/reject',
  authenticate,
  requireRole(UserRole.CUSTOMER),
  async (req: any, res) => {
    try {
      const { rows: [parcel] } = await db.query(
        'SELECT * FROM parcels WHERE parcel_id=$1 AND sender_id=$2',
        [req.params.id, req.actor.user_id]
      );
      if (!parcel) return res.status(404).json({ success: false, message: 'PARCEL_001: Not your parcel' });

      const event = {
        parcel_id:     parcel.parcel_id,
        event_type:    'PARCEL_REPRICING_REJECTED',
        event_version: 1,
        actor_type:    'CUSTOMER',
        actor_id:      req.actor.user_id,
        office_id:     parcel.origin_office_id,
        payload:       { rejected_at: new Date().toISOString(), reason: req.body.reason || 'Customer rejected' },
        occurred_at:   new Date().toISOString(),
      };

      await db.query(
        `INSERT INTO parcel_events
           (parcel_id,event_type,event_version,actor_type,actor_id,office_id,payload,occurred_at,recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
        [event.parcel_id, event.event_type, event.event_version,
         event.actor_type, event.actor_id, event.office_id,
         JSON.stringify(event.payload), event.occurred_at]
      );

      await rebuildProjection(event, parcel);
      await publishEvent('parcel.repricing', { ...event, service: 'parcel-service' });

      res.json({ success: true, message: 'Repricing rejected — return flow initiated' });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

export default router;