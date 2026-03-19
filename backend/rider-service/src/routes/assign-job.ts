import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { redis } from '../redis';
import { publishEvent } from '../qstash';
import { authenticate, requireRole } from '../middleware';
 
const router = Router();
 
// ================================================================
// POST /riders/assign-job
// Called by parcel-service to assign a job to a rider
// ================================================================
router.post('/assign-job',
  authenticate,
  async (req: any, res) => {
    try {
      const body = z.object({
        rider_id:          z.string().uuid(),
        parcel_id:         z.string().uuid(),
        job_type:          z.enum(['PICKUP', 'DELIVERY']),
        booking_reference: z.string(),
        pickup_gps_lat:    z.number().nullable().optional(),
        pickup_gps_lng:    z.number().nullable().optional(),
        delivery_gps_lat:  z.number().nullable().optional(),
        delivery_gps_lng:  z.number().nullable().optional(),
        notes:             z.string().optional(),
      }).parse(req.body);
 
      // Check rider exists and is available
      const { rows: [rider] } = await db.query(
        `SELECT r.rider_id, r.status, r.availability, u.full_name, u.phone
         FROM riders r
         JOIN app_users u ON u.user_id = r.user_id
         WHERE r.user_id = $1`,
        [body.rider_id]
      );
 
      if (!rider) {
        return res.status(404).json({ success: false, message: 'Rider not found' });
      }
 
      if (rider.status === 'SUSPENDED') {
        return res.status(400).json({ success: false, message: 'Rider is suspended' });
      }
 
      // Check for existing active job on same parcel
      const { rows: [existingJob] } = await db.query(
        `SELECT job_id FROM rider_jobs
         WHERE parcel_id = $1
           AND job_type = $2
           AND status NOT IN ('COMPLETED','CANCELLED','FAILED')`,
        [body.parcel_id, body.job_type]
      );
 
      if (existingJob) {
        return res.status(400).json({
          success: false,
          message: `A ${body.job_type} job already exists for this parcel`,
        });
      }
 
      // Create job
      const { rows: [job] } = await db.query(
        `INSERT INTO rider_jobs (
          rider_id, parcel_id, job_type, status,
          pickup_gps_lat, pickup_gps_lng,
          delivery_gps_lat, delivery_gps_lng,
          notes, assigned_at
        ) VALUES ($1,$2,$3,'ASSIGNED',$4,$5,$6,$7,$8,NOW())
        RETURNING job_id, rider_id, parcel_id, job_type, status, assigned_at`,
        [
          body.rider_id, body.parcel_id, body.job_type,
          body.pickup_gps_lat   || null,
          body.pickup_gps_lng   || null,
          body.delivery_gps_lat || null,
          body.delivery_gps_lng || null,
          body.notes || '',
        ]
      );
 
      // Update rider status
      await db.query(
        `UPDATE riders SET status = 'ON_JOB', updated_at = NOW()
         WHERE user_id = $1`,
        [body.rider_id]
      );
 
      // Cache active jobs in Redis
      const cachedJobs = await redis.get(`rider:${body.rider_id}:jobs`);
      const jobs = cachedJobs ? JSON.parse(cachedJobs) : [];
      jobs.push(job);
      await redis.setEx(`rider:${body.rider_id}:jobs`, 3600, JSON.stringify(jobs));
 
      // Publish event
      await publishEvent('rider.job_assigned', {
        job_id:    job.job_id,
        rider_id:  body.rider_id,
        parcel_id: body.parcel_id,
        job_type:  body.job_type,
        booking_reference: body.booking_reference,
        service:   'rider-service',
      });
 
      res.json({
        success: true,
        message: `Job assigned to rider ${rider.full_name}`,
        data: {
          job_id:    job.job_id,
          rider_id:  body.rider_id,
          parcel_id: body.parcel_id,
          job_type:  body.job_type,
          status:    'ASSIGNED',
        },
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);
 
export default router;
 