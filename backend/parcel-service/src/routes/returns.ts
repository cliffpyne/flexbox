import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { authenticate, requireRole } from '../middleware';
import { publishEvent } from '../qstash';
import { rebuildProjection } from '../projection';
import { generateBookingReference } from '../utils';
import { UserRole } from '@flexbox/types';
import { SLA } from '@flexbox/constants';

const router = Router({ mergeParams: true });

// ================================================================
// POST /parcels/:id/return — Initiate a return
// ================================================================
router.post('/',
  authenticate,
  async (req: any, res) => {
    try {
      const body = z.object({
        return_type:  z.enum(['DELIVERY_FAILURE','CUSTOMER_INITIATED','OFFICE_REJECTION']),
        reason:       z.string().min(5),
        cost_bearer:  z.enum(['SENDER','RECEIVER','PLATFORM']).optional(),
      }).parse(req.body);

      const { rows: [parcel] } = await db.query(
        'SELECT * FROM parcels WHERE parcel_id=$1', [req.params.id]
      );
      if (!parcel) return res.status(404).json({ success: false, message: 'PARCEL_001: Not found' });

      // Customers can only return own parcels
      if (req.actor.role === UserRole.CUSTOMER && parcel.sender_id !== req.actor.user_id) {
        return res.status(403).json({ success: false, message: 'AUTH_008: Not your parcel' });
      }

      // Check return window for customer-initiated returns
      if (req.actor.role === UserRole.CUSTOMER) {
        const parcelAge = Date.now() - new Date(parcel.created_at).getTime();
        if (parcelAge > SLA.RETURN_WINDOW_SECS * 1000) {
          return res.status(400).json({ success: false, message: 'PARCEL_005: Return window expired' });
        }
      }

      // Create reverse parcel — dest becomes origin, origin becomes dest
      const return_booking_reference = await generateBookingReference();

      const { rows: [returnParcel] } = await db.query(
        `INSERT INTO parcels (
          booking_reference, sender_id, receiver_phone,
          origin_office_id, dest_office_id,
          route_code, universe, item_category,
          is_fragile, is_high_value,
          declared_weight_kg, declared_length_cm, declared_width_cm, declared_height_cm,
          estimated_price, deposit_amount,
          parent_booking_id, return_type
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,0,$16,$17)
        RETURNING *`,
        [
          return_booking_reference,
          parcel.sender_id,
          parcel.receiver_phone,
          parcel.dest_office_id,    // ← reversed
          parcel.origin_office_id,  // ← reversed
          parcel.route_code,
          parcel.universe,
          parcel.item_category,
          parcel.is_fragile,
          parcel.is_high_value,
          parcel.confirmed_weight_kg || parcel.declared_weight_kg,
          parcel.confirmed_length_cm || parcel.declared_length_cm,
          parcel.confirmed_width_cm  || parcel.declared_width_cm,
          parcel.confirmed_height_cm || parcel.declared_height_cm,
          0, // Return price TBD
          parcel.parcel_id,
          body.return_type,
        ]
      );

      // Fire PARCEL_RETURN_INITIATED on original parcel
      const event = {
        parcel_id:     parcel.parcel_id,
        event_type:    'PARCEL_RETURN_INITIATED',
        event_version: 1,
        actor_type:    req.actor.role,
        actor_id:      req.actor.user_id,
        office_id:     parcel.origin_office_id,
        payload: {
          return_type:              body.return_type,
          reason:                   body.reason,
          cost_bearer:              body.cost_bearer || 'PLATFORM',
          return_parcel_id:         returnParcel.parcel_id,
          return_booking_reference,
        },
        occurred_at: new Date().toISOString(),
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
      await publishEvent('parcel.return', { ...event, service: 'parcel-service' });

      res.status(201).json({
        success: true,
        data: {
          return_parcel_id:         returnParcel.parcel_id,
          return_booking_reference,
          cost_bearer:              body.cost_bearer || 'PLATFORM',
          original_parcel_id:       parcel.parcel_id,
        }
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

export default router;