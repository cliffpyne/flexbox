import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { redis } from '../redis';
import { authenticate, requireRole } from '../middleware';
import { publishEvent } from '../qstash';
import { rebuildProjection } from '../projection';
import { UserRole } from '@flexbox/types';
 
const router = Router({ mergeParams: true });
 
const RIDER_SERVICE_URL = process.env.RIDER_SERVICE_URL || 'https://flexboxrider-service-production.up.railway.app';
 
// ================================================================
// POST /parcels/:id/assign-officer
// Assign an office worker to follow up this parcel end to end
// ================================================================
router.post('/assign-officer',
  authenticate,
  requireRole(UserRole.OFFICE_MANAGER, UserRole.BRANCH_MANAGER, UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const body = z.object({
        officer_id:  z.string().uuid(),
        occurred_at: z.string().datetime().optional(),
      }).parse(req.body);
 
      const { rows: [parcel] } = await db.query(
        'SELECT * FROM parcels WHERE parcel_id=$1',
        [req.params.id]
      );
      if (!parcel) return res.status(404).json({ success: false, message: 'PARCEL_001: Not found' });
 
      // Verify officer belongs to origin office
      const { rows: [officer] } = await db.query(
        `SELECT u.user_id, u.full_name, u.role, u.office_id
         FROM app_users u
         WHERE u.user_id = $1
           AND u.office_id = $2
           AND u.is_active = true
           AND u.role IN ('OFFICE_WORKER','OFFICE_MANAGER')`,
        [body.officer_id, parcel.origin_office_id]
      );
      if (!officer) {
        return res.status(400).json({
          success: false,
          message: 'Officer not found or does not belong to origin office',
        });
      }
 
      // Update parcel with assigned officer
      await db.query(
        `UPDATE parcels SET assigned_officer_id = $1, updated_at = NOW()
         WHERE parcel_id = $2`,
        [body.officer_id, parcel.parcel_id]
      );
 
      // Log event
      const occurred_at = body.occurred_at || new Date().toISOString();
      const event = {
        parcel_id:     parcel.parcel_id,
        event_type:    'OFFICER_ASSIGNED',
        event_version: 1,
        actor_type:    req.actor.role,
        actor_id:      req.actor.user_id,
        office_id:     parcel.origin_office_id,
        payload: {
          officer_id:   body.officer_id,
          officer_name: officer.full_name,
          officer_role: officer.role,
        },
        gps_lat:     null,
        gps_lng:     null,
        occurred_at,
      };
 
      await db.query(
        `INSERT INTO parcel_events
           (parcel_id, event_type, event_version, actor_type, actor_id,
            office_id, payload, occurred_at, recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
        [
          event.parcel_id, event.event_type, event.event_version,
          event.actor_type, event.actor_id, event.office_id,
          JSON.stringify(event.payload), event.occurred_at,
        ]
      );
 
      await rebuildProjection(event, parcel);
      await publishEvent('parcel.officer_assigned', { ...event, service: 'parcel-service' });
 
      res.json({
        success: true,
        message: `Officer ${officer.full_name} assigned to parcel ${parcel.booking_reference}`,
        data: {
          parcel_id:    parcel.parcel_id,
          officer_id:   body.officer_id,
          officer_name: officer.full_name,
        },
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);
 
// ================================================================
// POST /parcels/:id/assign-rider
// Assign a pickup rider to collect parcel from sender
// Calls rider-service to create the job
// ================================================================
router.post('/assign-rider',
  authenticate,
  requireRole(UserRole.OFFICE_WORKER, UserRole.OFFICE_MANAGER, UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const body = z.object({
        rider_id:    z.string().uuid(),
        job_type:    z.enum(['PICKUP', 'DELIVERY']).default('PICKUP'),
        notes:       z.string().optional(),
        occurred_at: z.string().datetime().optional(),
      }).parse(req.body);
 
      const { rows: [parcel] } = await db.query(
        'SELECT * FROM parcels WHERE parcel_id=$1',
        [req.params.id]
      );
      if (!parcel) return res.status(404).json({ success: false, message: 'PARCEL_001: Not found' });
 
      // Call rider-service to create job
      const riderRes = await fetch(`${RIDER_SERVICE_URL}/riders/assign-job`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  req.headers.authorization || '',
        },
        body: JSON.stringify({
          rider_id:         body.rider_id,
          parcel_id:        parcel.parcel_id,
          job_type:         body.job_type,
          booking_reference: parcel.booking_reference,
          pickup_gps_lat:   parcel.pickup_lat,
          pickup_gps_lng:   parcel.pickup_lng,
          delivery_gps_lat: parcel.delivery_lat,
          delivery_gps_lng: parcel.delivery_lng,
          notes:            body.notes || '',
        }),
      });
 
      const riderData = await riderRes.json() as any;
      if (!riderData.success) {
        return res.status(400).json({
          success: false,
          message: riderData.message || 'Failed to assign rider job',
        });
      }
 
      // Update parcel
      await db.query(
        `UPDATE parcels SET assigned_rider_id = $1, updated_at = NOW()
         WHERE parcel_id = $2`,
        [body.rider_id, parcel.parcel_id]
      );
 
      // Log event
      const occurred_at = body.occurred_at || new Date().toISOString();
      const event = {
        parcel_id:     parcel.parcel_id,
        event_type:    'RIDER_ASSIGNED',
        event_version: 1,
        actor_type:    req.actor.role,
        actor_id:      req.actor.user_id,
        office_id:     parcel.origin_office_id,
        payload: {
          rider_id:  body.rider_id,
          job_id:    riderData.data?.job_id,
          job_type:  body.job_type,
        },
        gps_lat:     null,
        gps_lng:     null,
        occurred_at,
      };
 
      await db.query(
        `INSERT INTO parcel_events
           (parcel_id, event_type, event_version, actor_type, actor_id,
            office_id, payload, occurred_at, recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
        [
          event.parcel_id, event.event_type, event.event_version,
          event.actor_type, event.actor_id, event.office_id,
          JSON.stringify(event.payload), event.occurred_at,
        ]
      );
 
      await rebuildProjection(event, parcel);
      await publishEvent('parcel.rider_assigned', { ...event, service: 'parcel-service' });
 
      res.json({
        success: true,
        message: `Rider assigned to parcel ${parcel.booking_reference}`,
        data: {
          parcel_id: parcel.parcel_id,
          rider_id:  body.rider_id,
          job_id:    riderData.data?.job_id,
          job_type:  body.job_type,
        },
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);
 
export default router;