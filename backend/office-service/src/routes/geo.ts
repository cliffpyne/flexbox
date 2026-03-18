import { Router } from 'express';
import { db } from '../db';
import { redis } from '../redis';
import { authenticate } from '../middleware';
import { roundGPS } from '../utils';

const router = Router();

// ================================================================
// GET /offices/serving?lat=&lng=&type=PICKUP
// Which office covers this GPS point?
// Called by Parcel Service at EVERY booking — must be fast
// ================================================================
router.get('/serving', authenticate, async (req: any, res) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const type = (req.query.type as string) || 'PICKUP';

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ success: false, message: 'lat and lng are required' });
    }

    // Check Redis cache first — geo queries are expensive
    const { lat: rLat, lng: rLng } = roundGPS(lat, lng);
    const cacheKey = `covering:${rLat}:${rLng}:${type}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json({ success: true, data: JSON.parse(cached) });
    }

    // PostGIS ST_Within query — the core geo routing query
    const { rows: [office] } = await db.query(
      `SELECT o.office_id, o.office_code, o.name, o.capabilities, o.status
       FROM offices o
       JOIN office_coverage_zones z ON z.office_id = o.office_id
       WHERE o.status = 'ACTIVE'
         AND z.zone_type = $1
         AND z.is_active = true
         AND ST_Within(
  ST_SetSRID(ST_MakePoint($2, $3), 4326),
  z.polygon::geometry
)
       ORDER BY
         CASE o.office_type WHEN 'HUB' THEN 1 WHEN 'BRANCH' THEN 2 ELSE 3 END
       LIMIT 1`,
      [type, lng, lat]  // Note: PostGIS is lng first then lat
    );

    if (!office) {
      // No coverage — find nearest office as suggestion
      const { rows: [nearest] } = await db.query(
        `SELECT office_id, name, address,
                ST_Distance(
                  ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                  ST_SetSRID(ST_MakePoint(gps_lng, gps_lat), 4326)::geography
                ) / 1000 as distance_km
         FROM offices
         WHERE status = 'ACTIVE'
         ORDER BY distance_km ASC
         LIMIT 1`,
        [lng, lat]
      );

      const result = {
        covered: false,
        office_id: null,
        message: 'No FlexSend coverage at this location yet',
        nearest_office: nearest || null,
      };

      // Cache negative result for 5 minutes
      await redis.setEx(cacheKey, 300, JSON.stringify(result));
      return res.json({ success: true, data: result });
    }

    const result = {
      covered: true,
      office_id: office.office_id,
      office_code: office.office_code,
      office_name: office.name,
      capabilities: office.capabilities,
    };

    // Cache for 5 minutes
    await redis.setEx(cacheKey, 300, JSON.stringify(result));

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
// GET /offices/nearest?lat=&lng=
// Find 3 nearest active offices — for self-dropoff suggestions
// ================================================================
router.get('/nearest', authenticate, async (req: any, res) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ success: false, message: 'lat and lng are required' });
    }

    const { rows } = await db.query(
      `SELECT
         office_id, name, address, office_type,
         gps_lat, gps_lng,
         capabilities->>'accepts_self_dropoff' as accepts_self_dropoff,
         ST_Distance(
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
           ST_SetSRID(ST_MakePoint(gps_lng, gps_lat), 4326)::geography
         ) / 1000 as distance_km
       FROM offices
       WHERE status = 'ACTIVE'
       ORDER BY distance_km ASC
       LIMIT 3`,
      [lng, lat]
    );

    res.json({ success: true, data: rows });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
// GET /offices/:id/coverage-check?lat=&lng=&type=
// Is this specific point inside this office's zone?
// ================================================================
router.get('/:id/coverage-check', authenticate, async (req: any, res) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const type = (req.query.type as string) || 'PICKUP';

    const { rows: [zone] } = await db.query(
      `SELECT zone_id, zone_type,
              ST_Within(
                ST_SetSRID(ST_MakePoint($1, $2), 4326),
                polygon
              ) as covered
       FROM office_coverage_zones
       WHERE office_id = $3
         AND zone_type = $4
         AND is_active = true
       LIMIT 1`,
      [lng, lat, req.params.id, type]
    );

    if (!zone) {
      return res.json({ success: true, data: { covered: false, zone_id: null, zone_type: type } });
    }

    res.json({ success: true, data: { covered: zone.covered, zone_id: zone.zone_id, zone_type: type } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
// GET /offices/:id/booking-options?universe=UPCOUNTRY
// What can a customer choose from this office?
// ================================================================
router.get('/:id/booking-options', authenticate, async (req: any, res) => {
  try {
    const universe = (req.query.universe as string) || 'UPCOUNTRY';

    // Check Redis cache
    const cacheKey = `office:${req.params.id}:capabilities`;
    let capabilities: any;
    const cached = await redis.get(cacheKey);
    if (cached) {
      capabilities = JSON.parse(cached);
    } else {
      const { rows: [office] } = await db.query(
        'SELECT capabilities, name, office_id, sla_config FROM offices WHERE office_id=$1',
        [req.params.id]
      );
      if (!office) return res.status(404).json({ success: false, message: 'OFFICE_001: Not found' });
      capabilities = office.capabilities;
      await redis.setEx(cacheKey, 3600, JSON.stringify(capabilities));
    }

    const { rows: [office] } = await db.query(
      'SELECT name, sla_config FROM offices WHERE office_id=$1',
      [req.params.id]
    );

    // Build origin options based on capability flags
    const origin_options = [];

    if (capabilities.has_pickup_riders) {
      origin_options.push({
        code: 'A1',
        label: 'Pickup from my address',
        available: true,
        fee: 2000,
        estimated_wait: `Within ${office.sla_config?.pickup_sla_hours || 2} hours`,
      });
    }

    if (capabilities.accepts_self_dropoff) {
      origin_options.push({
        code: 'A2',
        label: 'I will drop off at the office',
        available: true,
        fee: 0,
        estimated_wait: 'Bring anytime during operating hours',
      });
    }

    if (capabilities.has_active_agents) {
      origin_options.push({
        code: 'A3',
        label: 'My agent will drop off',
        available: true,
        fee: 0,
        estimated_wait: 'Agent will drop off',
      });
    }

    // Build last mile options
    const last_mile_options = [];

    if (capabilities.has_last_mile_delivery_riders) {
      last_mile_options.push({
        code: 'D1',
        label: 'Deliver to receiver address',
        available: true,
        fee: 2500,
      });
    }

    // Self pickup should always be available
    last_mile_options.push({
      code: 'D2',
      label: 'Receiver picks up from office',
      available: true,
      fee: 0,
    });

    // Special options
    const special_options = {
      express_available: capabilities.supports_express_same_day && universe === 'IN_REGION',
      express_fee: capabilities.supports_express_same_day ? 5000 : null,
      special_protection_available: capabilities.has_special_protection_boxing,
      special_protection_fee: capabilities.has_special_protection_boxing ? 3500 : null,
      direct_rider_available: capabilities.supports_direct_single_rider && universe === 'IN_REGION',
      intercity_available: capabilities.has_intercity_dispatch && universe === 'UPCOUNTRY',
    };

    res.json({
      success: true,
      data: {
        office_id: req.params.id,
        office_name: office.name,
        universe,
        origin_options,
        last_mile_options,
        special_options,
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;