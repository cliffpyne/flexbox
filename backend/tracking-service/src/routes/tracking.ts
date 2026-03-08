import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { redis } from '../redis';
import { authenticate } from '../middleware';
import { publishEvent } from '../qstash';
import { LOCATION_SOURCE_MAP, STATIC_SOURCES, computeIsStale } from '../location-map';
import { UserRole } from '@flexbox/types';

const router = Router();

// ================================================================
// POST /tracking/gps/box — GPS ping from hardware box
// Fast path: <2ms. Geofence async via QStash.
// ================================================================
router.post('/gps/box', async (req, res) => {
  try {
    // Device auth — API key not JWT
    const apiKey = req.headers['x-device-api-key'];
    if (!apiKey || apiKey !== process.env.GPS_DEVICE_API_KEY) {
      return res.status(401).json({ success: false, message: 'Invalid device key' });
    }

    const body = z.object({
      gps_device_id: z.string(),
      lat:           z.number(),
      lng:           z.number(),
      speed_kmh:     z.number().optional().default(0),
      heading:       z.number().optional().nullable(),
      accuracy_m:    z.number().optional().nullable(),
      battery_pct:   z.number().optional().nullable(),
      is_moving:     z.boolean().default(false),
      timestamp:     z.string(),
    }).parse(req.body);

    // Deduplication — ignore identical ping within 10 seconds
    const dedupKey = `box_ping:${body.gps_device_id}`;
    const lastPing = await redis.get(dedupKey);
    if (lastPing) {
      const last = JSON.parse(lastPing);
      if (last.lat === body.lat && last.lng === body.lng) {
        return res.json({ received: true, deduplicated: true });
      }
    }
    await redis.set(dedupKey, JSON.stringify({ lat: body.lat, lng: body.lng }), { EX: 10 });

    // Look up box
    const { rows: [box] } = await db.query(
      'SELECT * FROM gps_boxes WHERE gps_device_id=$1', [body.gps_device_id]
    );
    if (!box) return res.json({ received: false, reason: 'Unknown device' });

    // Update Redis location (fast — no DB)
    const locationData = {
      lat: body.lat, lng: body.lng,
      speed_kmh: body.speed_kmh, heading: body.heading,
      is_moving: body.is_moving, last_updated: body.timestamp
    };
    await redis.set(`box:${box.box_id}:last_ping`, body.timestamp, { EX: 3600 });
    await redis.set(`rider:location:box:${box.box_id}`, JSON.stringify(locationData), { EX: 300 });

    // Update parcel location if box is assigned and in transit
    if (box.status === 'IN_TRANSIT' && box.assigned_parcel_id) {
      const unifiedLocation = {
        lat: body.lat, lng: body.lng,
        source: 'HARDWARE_GPS', source_id: box.box_id,
        label: 'In transit — GPS tracking',
        is_moving: body.is_moving, speed_kmh: body.speed_kmh,
        heading: body.heading, accuracy_m: body.accuracy_m,
        last_updated: body.timestamp, is_stale: false,
      };
      await redis.set(`parcel:${box.assigned_parcel_id}:location`, JSON.stringify(unifiedLocation), { EX: 600 });

      // Update tracking projection
      const tracking = await redis.get(`parcel:${box.assigned_parcel_id}:tracking`);
      if (tracking) {
        const updated = { ...JSON.parse(tracking), current_location: unifiedLocation };
        await redis.set(`parcel:${box.assigned_parcel_id}:tracking`, JSON.stringify(updated));
        await redis.publish(`parcel:${box.assigned_parcel_id}:tracking`, JSON.stringify(updated));
      }
    }

    // Battery alert
    if (body.battery_pct !== null && body.battery_pct !== undefined && body.battery_pct < 20) {
      await publishEvent('box.abnormality', {
        event_type: 'BOX_LOW_BATTERY', box_id: box.box_id,
        battery_pct: body.battery_pct, service: 'tracking-service'
      });
    }

    // Push to QStash for async geofence processing
    await publishEvent('box.gps', {
      box_id: box.box_id, gps_device_id: body.gps_device_id,
      lat: body.lat, lng: body.lng,
      assigned_parcel_id: box.assigned_parcel_id,
      status: box.status, timestamp: body.timestamp,
      service: 'tracking-service'
    }, { dedup_id: `gps-${body.gps_device_id}-${body.timestamp}` });

    res.json({ received: true });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ================================================================
// POST /tracking/gps/rider — Rider phone GPS
// Max 1 ping per 5 seconds per rider
// ================================================================
router.post('/gps/rider', authenticate, async (req: any, res) => {
  try {
    const body = z.object({
      lat:        z.number(),
      lng:        z.number(),
      speed_kmh:  z.number().default(0),
      heading:    z.number().nullable().optional(),
      accuracy_m: z.number().nullable().optional(),
      is_moving:  z.boolean().default(false),
    }).parse(req.body);

    const riderId = req.actor.user_id;

    // Rate limit: 1 ping per 5 seconds per rider
    const rateLimitKey = `rider_ping_rate:${riderId}`;
    const limited = await redis.get(rateLimitKey);
    if (limited) return res.json({ received: true, rate_limited: true });
    await redis.set(rateLimitKey, '1', { EX: 5 });

    const now = new Date().toISOString();
    const locationData = {
      lat: body.lat, lng: body.lng, speed_kmh: body.speed_kmh,
      heading: body.heading, is_moving: body.is_moving, last_updated: now
    };

    // Store rider location
    await redis.set(`rider:${riderId}:location`, JSON.stringify(locationData), { EX: 300 });

    // Update all parcels assigned to this rider in RIDER_PHONE mode
    const { rows: activeParcels } = await db.query(
      `SELECT p.parcel_id FROM parcels p
       WHERE (p.assigned_rider_id=$1 OR p.last_mile_rider_id=$1)
       AND p.status NOT IN ('DELIVERED','RETURN_DELIVERED','CANCELLED')`,
      [riderId]
    );

    for (const parcel of activeParcels) {
      const cachedLoc = await redis.get(`parcel:${parcel.parcel_id}:location`);
      if (cachedLoc) {
        const loc = JSON.parse(cachedLoc);
        if (loc.source === 'RIDER_PHONE') {
          const updated = { ...loc, lat: body.lat, lng: body.lng, speed_kmh: body.speed_kmh, heading: body.heading, is_moving: body.is_moving, last_updated: now };
          await redis.set(`parcel:${parcel.parcel_id}:location`, JSON.stringify(updated), { EX: 300 });
          const tracking = await redis.get(`parcel:${parcel.parcel_id}:tracking`);
          if (tracking) {
            const updatedTracking = { ...JSON.parse(tracking), current_location: updated };
            await redis.set(`parcel:${parcel.parcel_id}:tracking`, JSON.stringify(updatedTracking));
            await redis.publish(`parcel:${parcel.parcel_id}:tracking`, JSON.stringify(updatedTracking));
          }
        }
      }
    }

    // Publish to Redis WebSocket gateway directly (1 retry only — stale)
    await redis.publish(`rider:${riderId}:location`, JSON.stringify(locationData));

    res.json({ received: true });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ================================================================
// GET /tracking/:parcelId — Get current parcel location
// ================================================================
router.get('/:parcelId', authenticate, async (req: any, res) => {
  try {
    const cached = await redis.get(`parcel:${req.params.parcelId}:location`);
    if (cached) {
      const loc = JSON.parse(cached);
      loc.is_stale = computeIsStale(loc.last_updated);

      // Strip box details from non-admin roles
      if (!['OPS_ADMIN','SUPER_ADMIN','OFFICE_MANAGER','BRANCH_MANAGER'].includes(req.actor.role)) {
        delete loc.source_id;
      }
      return res.json({ success: true, data: loc });
    }

    // Fallback to DB
    const { rows: [parcel] } = await db.query(
      'SELECT pickup_lat, pickup_lng, created_at FROM parcels WHERE parcel_id=$1',
      [req.params.parcelId]
    );
    if (!parcel) return res.status(404).json({ success: false, message: 'Parcel not found' });

    const fallback = {
      lat: parcel.pickup_lat, lng: parcel.pickup_lng,
      source: 'STATIC_SENDER', label: 'Sender address',
      is_moving: false, speed_kmh: null, heading: null, accuracy_m: null,
      last_updated: parcel.created_at, is_stale: true,
    };
    res.json({ success: true, data: fallback });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
// GET /tracking/rider/:riderId — Rider current location
// ================================================================
router.get('/rider/:riderId', authenticate, async (req: any, res) => {
  try {
    const cached = await redis.get(`rider:${req.params.riderId}:location`);
    if (!cached) return res.status(404).json({ success: false, message: 'Rider location not available' });
    const loc = JSON.parse(cached);
    res.json({ success: true, data: { ...loc, rider_id: req.params.riderId, is_stale: computeIsStale(loc.last_updated) } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
// GET /tracking/network — Full ops admin network view
// Reads from Redis only — never hits DB
// ================================================================
router.get('/network/overview', authenticate, async (req: any, res) => {
  try {
    if (!['OPS_ADMIN','SUPER_ADMIN'].includes(req.actor.role)) {
      return res.status(403).json({ success: false, message: 'Ops Admin only' });
    }

    // Get all active offices
    const { rows: offices } = await db.query(
      'SELECT office_id, name, office_code, gps_lat, gps_lng, status FROM offices WHERE status=\'ACTIVE\''
    );

    // Get active rider locations from Redis
    const riderKeys = await redis.keys('rider:*:location');
    const riders = [];
    for (const key of riderKeys.slice(0, 100)) { // Cap at 100
      const loc = await redis.get(key);
      if (loc) {
        const riderId = key.split(':')[1];
        riders.push({ rider_id: riderId, ...JSON.parse(loc) });
      }
    }

    // Get ML alerts from Redis
    const alerts = await redis.get('ops:ml_alerts') || '[]';

    res.json({ success: true, data: {
      offices, active_riders: riders,
      boxes_in_transit: [], // populated by tracking from GPS pings
      ml_alerts: JSON.parse(alerts),
    }});
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
// POST /webhooks/parcel/* — Mode switching on parcel events
// ================================================================
router.post('/webhooks/parcel/mode-switch', async (req, res) => {
  try {
    const event = req.body;
    const mapping = LOCATION_SOURCE_MAP[event.event_type];
    if (!mapping) return res.json({ ok: true, skipped: true });

    const parcelId = event.parcel_id;
    const p = event.payload || {};

    // Resolve sourceId
    let sourceId = '';
    let lat: number | null = null;
    let lng: number | null = null;
    let label = mapping.label;

    if (mapping.source === 'RIDER_PHONE') {
      sourceId = p.rider_id || p.last_mile_rider_id || event.actor_id;
      const riderLoc = await redis.get(`rider:${sourceId}:location`);
      if (riderLoc) { const l = JSON.parse(riderLoc); lat = l.lat; lng = l.lng; }
    } else if (mapping.source === 'HARDWARE_GPS') {
      sourceId = p.box_id || p.active_box_id || '';
      const boxLoc = await redis.get(`rider:location:box:${sourceId}`);
      if (boxLoc) { const l = JSON.parse(boxLoc); lat = l.lat; lng = l.lng; }
    } else if (mapping.source === 'STATIC_OFFICE') {
      sourceId = p.office_id || p.dest_office_id || p.origin_office_id || '';
      const { rows: [office] } = await db.query(
        'SELECT gps_lat, gps_lng, name FROM offices WHERE office_id=$1', [sourceId]
      );
      if (office) { lat = office.gps_lat; lng = office.gps_lng; label = office.name; }
    } else {
      // STATIC_SENDER / STATIC_RECEIVER — from parcels table
      const { rows: [parcel] } = await db.query(
        'SELECT pickup_lat, pickup_lng, delivery_lat, delivery_lng FROM parcels WHERE parcel_id=$1', [parcelId]
      );
      if (parcel) {
        lat = mapping.source === 'STATIC_SENDER' ? parcel.pickup_lat : parcel.delivery_lat;
        lng = mapping.source === 'STATIC_SENDER' ? parcel.pickup_lng : parcel.delivery_lng;
      }
      sourceId = parcelId;
    }

    const unifiedLocation = {
      lat, lng, source: mapping.source, source_id: sourceId, label,
      is_moving: !STATIC_SOURCES.includes(mapping.source),
      speed_kmh: null, heading: null, accuracy_m: null,
      last_updated: event.occurred_at, is_stale: false,
    };

    await redis.set(`parcel:${parcelId}:location`, JSON.stringify(unifiedLocation), { EX: 3600 });

    // Update tracking projection
    const tracking = await redis.get(`parcel:${parcelId}:tracking`);
    if (tracking) {
      const updated = { ...JSON.parse(tracking), current_location: unifiedLocation };
      await redis.set(`parcel:${parcelId}:tracking`, JSON.stringify(updated));
      await redis.publish(`parcel:${parcelId}:tracking`, JSON.stringify(updated));
    }

    res.json({ ok: true });
  } catch (err: any) {
    console.error(err);
    res.status(200).json({ ok: true, error: err.message }); // Always 200 for QStash
  }
});

// ================================================================
// POST /webhooks/box/gps — Async geofence check
// ================================================================
router.post('/webhooks/box/gps', async (req, res) => {
  try {
    const { box_id, lat, lng, assigned_parcel_id, status } = req.body;
    if (status !== 'IN_TRANSIT' || !assigned_parcel_id) return res.json({ ok: true });

    // Get parcel dest office
    const { rows: [parcel] } = await db.query(
      'SELECT dest_office_id FROM parcels WHERE parcel_id=$1', [assigned_parcel_id]
    );
    if (!parcel) return res.json({ ok: true });

    // Check Redis GEO proximity first (5km radius)
    const { rows: nearbyOffices } = await db.query(
      `SELECT office_id, name, ST_Distance(
         ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,
         gps_location::geography
       ) AS dist_m
       FROM offices WHERE status='ACTIVE'
       AND ST_DWithin(
         ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,
         gps_location::geography, 5000
       ) ORDER BY dist_m ASC LIMIT 3`,
      [lng, lat]
    );

    if (nearbyOffices.length === 0) return res.json({ ok: true });

    // PostGIS geofence check for nearby offices only
    const { rows: [geofenceHit] } = await db.query(
      `SELECT office_id FROM offices
       WHERE office_id=ANY($1)
       AND ST_Within(ST_SetSRID(ST_MakePoint($2,$3),4326), geofence_polygon)
       LIMIT 1`,
      [nearbyOffices.map((o: any) => o.office_id), lng, lat]
    );

    if (geofenceHit) {
      if (geofenceHit.office_id === parcel.dest_office_id) {
        // Publish BOX_ARRIVED_GEOFENCE event
        await publishEvent('box.geofence', {
          event_type: 'BOX_ARRIVED_GEOFENCE',
          box_id, parcel_id: assigned_parcel_id,
          office_id: geofenceHit.office_id,
          lat, lng, service: 'tracking-service'
        });
      } else {
        await publishEvent('box.geofence', {
          event_type: 'BOX_ENTERED_UNEXPECTED_OFFICE',
          box_id, parcel_id: assigned_parcel_id,
          expected_office: parcel.dest_office_id,
          actual_office: geofenceHit.office_id,
          service: 'tracking-service'
        });
      }
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.status(200).json({ ok: true, error: err.message });
  }
});

export default router;