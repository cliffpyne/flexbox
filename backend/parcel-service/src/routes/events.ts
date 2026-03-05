import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { authenticate } from '../middleware';
import { publishEvent } from '../qstash';
import { rebuildProjection } from '../projection';

const router = Router({ mergeParams: true });

// ================================================================
// POST /parcels/:id/events — Append a custody event
// Every scan, confirmation, delivery — everything goes here
// ================================================================
router.post('/',
  authenticate,
  async (req: any, res) => {
    try {
      const body = z.object({
        event_type:    z.string().min(1),
        event_id:      z.string().uuid().optional(), // Device-generated UUID for deduplication
        payload:       z.record(z.any()).default({}),
        occurred_at:   z.string().datetime(),
        gps_lat:       z.number().optional(),
        gps_lng:       z.number().optional(),
      }).parse(req.body);

      const { rows: [parcel] } = await db.query(
        'SELECT * FROM parcels WHERE parcel_id=$1', [req.params.id]
      );
      if (!parcel) return res.status(404).json({ success: false, message: 'PARCEL_001: Not found' });

      // ── Step 1: Validate event via Routing Service ────────────
      const routingUrl = process.env.ROUTING_SERVICE_URL || 'http://localhost:3003';
      const projection  = await (async () => {
        const c = await import('../redis').then(m => m.redis.get(`parcel:${parcel.parcel_id}:projection`));
        return c ? JSON.parse(c) : null;
      })();

      const validateRes = await fetch(`${routingUrl}/routes/validate-event`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization || '' },
        body: JSON.stringify({
          route_code:      parcel.route_code,
          current_level:   projection?.current_level || 'L0',
          last_event_type: projection?.last_event_type || null,
          event_type:      body.event_type,
          actor_role:      req.actor.role,
          actor_office_id: req.actor.office_id || null,
        }),
      }).catch(() => null);

      if (validateRes) {
        const validateData = await validateRes.json() as any;
        if (!validateData.valid) {
          return res.status(422).json({
            success: false,
            message: `Invalid event: ${validateData.reason}`,
            reason:  validateData.reason,
          });
        }
      }

      // ── Step 2: Deduplication check ───────────────────────────
      if (body.event_id) {
        const { rows: [existing] } = await db.query(
          'SELECT event_id FROM parcel_events WHERE event_id=$1',
          [body.event_id]
        );
        if (existing) {
          return res.json({ success: true, deduplicated: true, message: 'Event already processed' });
        }
      }

      // ── Step 3: Append event ──────────────────────────────────
      const { rows: [inserted] } = await db.query(
        `INSERT INTO parcel_events
           (event_id,parcel_id,event_type,event_version,actor_type,actor_id,
            office_id,payload,gps_lat,gps_lng,occurred_at,recorded_at)
         VALUES (
           COALESCE($1, gen_random_uuid()),
           $2,$3,1,$4,$5,$6,$7,$8,$9,$10,NOW()
         ) RETURNING *`,
        [
          body.event_id || null,
          parcel.parcel_id,
          body.event_type,
          req.actor.role,
          req.actor.user_id,
          req.actor.office_id || parcel.origin_office_id,
          JSON.stringify(body.payload),
          body.gps_lat || null,
          body.gps_lng || null,
          body.occurred_at,
        ]
      );

      // ── Step 4: Rebuild projection ────────────────────────────
      const updatedProjection = await rebuildProjection({
        parcel_id:     parcel.parcel_id,
        event_type:    body.event_type,
        payload:       body.payload,
        gps_lat:       body.gps_lat,
        gps_lng:       body.gps_lng,
        occurred_at:   body.occurred_at,
      }, parcel);

      // ── Step 5: Publish to QStash ─────────────────────────────
      const topic = body.event_type.toLowerCase().replace(/_/g, '.').replace('parcel.', 'parcel.');
      await publishEvent(`parcel.${body.event_type.toLowerCase()}`, {
        event_type: body.event_type,
        parcel_id:  parcel.parcel_id,
        event_id:   inserted.event_id,
        actor_id:   req.actor.user_id,
        actor_role: req.actor.role,
        payload:    body.payload,
        occurred_at: body.occurred_at,
        service:    'parcel-service',
      });

      res.json({
        success: true,
        data: {
          event_id:        inserted.event_id,
          sequence_number: inserted.sequence_number,
          projection:      updatedProjection,
        }
      });
    } catch (err: any) {
      console.error(err);
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ================================================================
// POST /parcels/batch-sync — Offline event sync from rider app
// Processes multiple events in occurred_at order with deduplication
// ================================================================
router.post('/batch-sync',
  authenticate,
  async (req: any, res) => {
    try {
      const { events } = z.object({
        events: z.array(z.object({
          event_id:    z.string().uuid(),
          parcel_id:   z.string().uuid(),
          event_type:  z.string(),
          payload:     z.record(z.any()).default({}),
          occurred_at: z.string().datetime(),
          gps_lat:     z.number().optional(),
          gps_lng:     z.number().optional(),
        }))
      }).parse(req.body);

      // Sort by occurred_at — device time is truth
      const sorted = events.sort((a, b) =>
        new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
      );

      const results = [];

      for (const event of sorted) {
        // Deduplication
        const { rows: [existing] } = await db.query(
          'SELECT event_id FROM parcel_events WHERE event_id=$1',
          [event.event_id]
        );
        if (existing) {
          results.push({ event_id: event.event_id, status: 'DUPLICATE_SKIPPED' });
          continue;
        }

        const { rows: [parcel] } = await db.query(
          'SELECT * FROM parcels WHERE parcel_id=$1', [event.parcel_id]
        );
        if (!parcel) {
          results.push({ event_id: event.event_id, status: 'PARCEL_NOT_FOUND' });
          continue;
        }

        await db.query(
          `INSERT INTO parcel_events
             (event_id,parcel_id,event_type,event_version,actor_type,actor_id,
              payload,gps_lat,gps_lng,occurred_at,recorded_at)
           VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,NOW())`,
          [
            event.event_id, event.parcel_id, event.event_type,
            req.actor.role, req.actor.user_id,
            JSON.stringify(event.payload),
            event.gps_lat || null, event.gps_lng || null,
            event.occurred_at,
          ]
        );

        await rebuildProjection(event, parcel);
        await publishEvent(`parcel.${event.event_type.toLowerCase()}`, {
          ...event, service: 'parcel-service', batch_sync: true
        });

        results.push({ event_id: event.event_id, status: 'PROCESSED' });
      }

      res.json({ success: true, data: { processed: results.length, results } });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

export default router;