import { Router }  from 'express';
import { z }       from 'zod';
import { db }      from '../db';
import { redis }   from '../redis';
import { authenticate, requireRole, requireSameOffice } from '../middleware';
import { publishEvent }  from '../qstash';
import { completeSLA, startSLA } from '../services/sla.service';
import { UserRole } from '@flexbox/types';

const router = Router({ mergeParams: true });

// ─────────────────────────────────────────────────────────────────────────────
// POST /offices/:id/transporter/dispatch
// Office assistant enters driver details and dispatches a box
// ML learns from each trip to predict future ETAs automatically
// ─────────────────────────────────────────────────────────────────────────────
router.post('/dispatch',
  authenticate,
  requireRole(UserRole.OFFICE_WORKER, UserRole.OFFICE_MANAGER, UserRole.OPS_ADMIN),
  requireSameOffice(),
  async (req: any, res) => {
    try {
      const body = z.object({
        box_id:             z.string().uuid(),
        driver_name:        z.string().min(2),
        driver_phone:       z.string().min(10),
        plate_number:       z.string().min(5),
        departure_time:     z.string().datetime(),
        estimated_arrival:  z.string().datetime(),
        notes:              z.string().optional(),
      }).parse(req.body);

      // Verify box is LOADED at this office
      const { rows: [box] } = await db.query(
        `SELECT b.*, p.dest_office_id,
                o.name as dest_office_name, o.region as dest_region,
                ir.estimated_hours as route_hours,
                ir.route_id
         FROM boxes b
         JOIN box_parcel_assignments bpa ON bpa.box_id = b.box_id AND bpa.removed_at IS NULL
         JOIN parcels p ON p.parcel_id = bpa.parcel_id
         JOIN offices o ON o.office_id = p.dest_office_id
         LEFT JOIN intercity_routes ir
           ON ir.origin_office_id = $1
           AND ir.dest_office_id = p.dest_office_id
           AND ir.is_active = true
         WHERE b.box_id = $2 AND b.current_office_id = $1 AND b.status = 'LOADED'
         LIMIT 1`,
        [req.params.id, body.box_id]
      );

      if (!box) {
        return res.status(404).json({
          success: false,
          message: 'Box not found at this office or not loaded',
        });
      }

      // Get ML-predicted ETA if available (from transit_eta_history)
      const departureHour  = new Date(body.departure_time).getHours();
      const departureDay   = new Date(body.departure_time).getDay();
      const routeKey       = `${req.params.id}:${box.dest_office_id}`;

      const { rows: [mlEta] } = await db.query(
        `SELECT
           AVG(EXTRACT(EPOCH FROM (actual_arrival - departure_time))/3600) as avg_hours,
           STDDEV(EXTRACT(EPOCH FROM (actual_arrival - departure_time))/3600) as stddev_hours,
           COUNT(*) as sample_count
         FROM transit_eta_history
         WHERE route_key = $1
           AND ABS(departure_hour - $2) <= 2
           AND departure_day_of_week = $3
           AND actual_arrival IS NOT NULL`,
        [routeKey, departureHour, departureDay]
      );

      const ml_predicted_hours = mlEta?.sample_count >= 5
        ? Math.round(parseFloat(mlEta.avg_hours) * 10) / 10
        : null;

      const ml_predicted_arrival = ml_predicted_hours
        ? new Date(new Date(body.departure_time).getTime() + ml_predicted_hours * 3600_000).toISOString()
        : null;

      // Create trip record
      const { rows: [trip] } = await db.query(
        `INSERT INTO transporter_trips (
           box_id, origin_office_id, dest_office_id,
           driver_name, driver_phone, plate_number,
           departure_time, estimated_arrival,
           ml_predicted_arrival, ml_sample_count,
           route_key, departure_hour, departure_day_of_week,
           entered_by, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'PENDING')
         RETURNING trip_id`,
        [
          body.box_id, req.params.id, box.dest_office_id,
          body.driver_name, body.driver_phone, body.plate_number,
          body.departure_time, body.estimated_arrival,
          ml_predicted_arrival, mlEta?.sample_count ?? 0,
          routeKey, departureHour, departureDay,
          req.actor.user_id,
        ]
      );

      // Update box status to IN_TRANSIT
      await db.query(
        `UPDATE boxes SET status = 'IN_TRANSIT', updated_at = NOW() WHERE box_id = $1`,
        [body.box_id]
      );

      // Get all parcels in this box
      const { rows: parcels } = await db.query(
        `SELECT p.parcel_id FROM box_parcel_assignments bpa
         JOIN parcels p ON p.parcel_id = bpa.parcel_id
         WHERE bpa.box_id = $1 AND bpa.removed_at IS NULL`,
        [body.box_id]
      );

      // Append events and update SLAs for all parcels
      const routeTransitHours = box.route_hours ?? 24;
      for (const parcel of parcels) {
        const { rows: [{ max: maxSeq }] } = await db.query(
          'SELECT MAX(sequence_number) FROM parcel_events WHERE parcel_id = $1',
          [parcel.parcel_id]
        );
        await db.query(
          `INSERT INTO parcel_events
             (parcel_id, event_type, sequence_number, actor_id, actor_role, occurred_at, payload)
           VALUES ($1, 'PARCEL_HANDED_TO_COURIER', $2, $3, $4, NOW(), $5)`,
          [
            parcel.parcel_id, (maxSeq ?? 0) + 1,
            req.actor.user_id, req.actor.role,
            JSON.stringify({
              trip_id:               trip.trip_id,
              box_id:                body.box_id,
              driver_name:           body.driver_name,
              plate_number:          body.plate_number,
              departure_time:        body.departure_time,
              estimated_arrival:     body.estimated_arrival,
              ml_predicted_arrival,
            }),
          ]
        );

        // Cancel DISPATCH SLA, start TRANSIT SLA
        await completeSLA(parcel.parcel_id, 'DISPATCH');
        await startSLA({
          parcel_id:            parcel.parcel_id,
          sla_type:             'TRANSIT_LEG',
          office_id:            req.params.id,
          custom_duration_secs: routeTransitHours * 3600 * 1.5, // 50% buffer
        });
      }

      // Store ETA in Redis so customer app can read it
      await redis.setEx(
        `trip:${trip.trip_id}:eta`,
        routeTransitHours * 3600 * 2,
        JSON.stringify({
          trip_id:              trip.trip_id,
          estimated_arrival:    body.estimated_arrival,
          ml_predicted_arrival,
          driver_name:          body.driver_name,
          dest_office_name:     box.dest_office_name,
        })
      );

      await publishEvent('parcel.handed_to_courier', {
        trip_id:          trip.trip_id,
        box_id:           body.box_id,
        origin_office_id: req.params.id,
        dest_office_id:   box.dest_office_id,
        parcel_ids:       parcels.map(p => p.parcel_id),
        departure_time:   body.departure_time,
        estimated_arrival: body.estimated_arrival,
        ml_predicted_arrival,
        service:          'office-service',
        timestamp:        new Date().toISOString(),
      });

      res.json({
        success: true,
        data: {
          trip_id:            trip.trip_id,
          box_serial:         box.box_serial,
          parcel_count:       parcels.length,
          dest_office:        box.dest_office_name,
          departure_time:     body.departure_time,
          estimated_arrival:  body.estimated_arrival,
          ml_predicted_arrival,
          ml_confidence:      mlEta?.sample_count >= 5
            ? `Based on ${mlEta.sample_count} previous trips on this route`
            : 'Not enough data yet — ML will learn from this trip',
          message: `Box ${box.box_serial} dispatched. ${parcels.length} parcels en route to ${box.dest_office_name}.`,
        },
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /offices/:id/transporter/trips/:tripId/arrived
// Called when box arrives at destination
// Records actual arrival time for ML training
// ─────────────────────────────────────────────────────────────────────────────
router.post('/trips/:tripId/arrived',
  authenticate,
  async (req: any, res) => {
    try {
      const { rows: [trip] } = await db.query(
        `SELECT * FROM transporter_trips WHERE trip_id = $1`,
        [req.params.tripId]
      );
      if (!trip) {
        return res.status(404).json({ success: false, message: 'Trip not found' });
      }

      // Record actual arrival — this is the ML training signal
      await db.query(
        `UPDATE transporter_trips
         SET actual_arrival = NOW(), status = 'ARRIVED', updated_at = NOW()
         WHERE trip_id = $1`,
        [req.params.tripId]
      );

      // Append to transit_eta_history for ML training
      await db.query(
        `INSERT INTO transit_eta_history (
           route_key, departure_time, estimated_arrival,
           actual_arrival, departure_hour, departure_day_of_week,
           variance_minutes
         ) VALUES ($1, $2, $3, NOW(), $4, $5,
           EXTRACT(EPOCH FROM (NOW() - $3))/60
         )`,
        [
          trip.route_key, trip.departure_time,
          trip.estimated_arrival, trip.departure_hour,
          trip.departure_day_of_week,
        ]
      );

      // Update box to ARRIVED
      await db.query(
        `UPDATE boxes
         SET status = 'ARRIVED', current_office_id = $1, updated_at = NOW()
         WHERE box_id = $2`,
        [trip.dest_office_id, trip.box_id]
      );

      res.json({
        success: true,
        message: 'Arrival recorded. ML training data saved.',
        data: {
          trip_id:       req.params.tripId,
          actual_arrival: new Date().toISOString(),
        },
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /offices/:id/transporter/eta-stats
// Show ML accuracy for this route — how well is it predicting?
// ─────────────────────────────────────────────────────────────────────────────
router.get('/eta-stats', authenticate, requireSameOffice(), async (req: any, res) => {
  try {
    const { dest_office_id } = req.query;

    const { rows } = await db.query(
      `SELECT
         route_key,
         COUNT(*)                    as total_trips,
         AVG(EXTRACT(EPOCH FROM (actual_arrival - departure_time))/3600) as avg_hours,
         MIN(EXTRACT(EPOCH FROM (actual_arrival - departure_time))/3600) as min_hours,
         MAX(EXTRACT(EPOCH FROM (actual_arrival - departure_time))/3600) as max_hours,
         AVG(ABS(variance_minutes))  as avg_variance_mins,
         MAX(recorded_at)            as last_trip
       FROM transit_eta_history
       WHERE route_key LIKE $1
         AND actual_arrival IS NOT NULL
       GROUP BY route_key
       ORDER BY total_trips DESC`,
      [`${req.params.id}:%`]
    );

    res.json({ success: true, data: rows });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
