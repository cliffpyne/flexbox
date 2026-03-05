import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { redis } from '../redis';
import { authenticate, requireRole } from '../middleware';
import { publishEvent } from '../qstash';
import { generateOfficeCode } from '../utils';
import { UserRole } from '@flexbox/types';

const router = Router();

// ================================================================
// POST /offices — Create office
// ================================================================
router.post('/',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const body = z.object({
        name:               z.string().min(2),
        region:             z.string().min(2),
        address:            z.string().min(5),
        gps_lat:            z.number().min(-90).max(90),
        gps_lng:            z.number().min(-180).max(180),
        geofence_radius_m:  z.number().min(50).max(5000).default(100),
        office_type:        z.enum(['HUB', 'BRANCH', 'MINI']),
        operating_hours:    z.record(z.object({
          open:   z.string(),
          close:  z.string(),
          closed: z.boolean(),
        })),
        capabilities:       z.record(z.boolean()),
        sla_config:         z.record(z.number().positive()),
        pricing_overrides:  z.record(z.any()).nullable().optional(),
      }).parse(req.body);

      // Validate all 7 days present
      const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
      for (const day of days) {
        if (!body.operating_hours[day]) {
          return res.status(400).json({
            success: false,
            message: `operating_hours missing ${day}`
          });
        }
      }

      const office_code = await generateOfficeCode(body.region, body.office_type);

      const { rows: [office] } = await db.query(
        `INSERT INTO offices (
          office_code, name, region, address,
          gps_lat, gps_lng, geofence_radius_meters,
          office_type, status, capabilities,
          sla_config, pricing_overrides, operating_hours,
          config_version, config_updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,'SETUP',$9,$10,$11,$12,1,NOW()
        ) RETURNING *`,
        [
          office_code, body.name, body.region, body.address,
          body.gps_lat, body.gps_lng, body.geofence_radius_m,
          body.office_type,
          JSON.stringify(body.capabilities),
          JSON.stringify(body.sla_config),
          body.pricing_overrides ? JSON.stringify(body.pricing_overrides) : null,
          JSON.stringify(body.operating_hours),
        ]
      );

      // Add to Redis GEO set
      await redis.geoAdd('geo:offices', {
        longitude: body.gps_lng,
        latitude:  body.gps_lat,
        member:    office.office_id,
      });

      await publishEvent('office.management', {
        event:     'OFFICE_CREATED',
        office_id: office.office_id,
        payload:   office,
        timestamp: new Date().toISOString(),
        service:   'office-service',
      });

      res.status(201).json({
        success: true,
        data: {
          office_id:   office.office_id,
          office_code: office.office_code,
          status:      office.status,
        }
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ================================================================
// GET /offices — List offices
// ================================================================
router.get('/',
  authenticate,
  requireRole(UserRole.BRANCH_MANAGER, UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const { region, status, type, page = 1, limit = 20 } = req.query;
      const offset = (Number(page) - 1) * Number(limit);

      const conditions: string[] = [];
      const params: any[] = [];
      let i = 1;

      if (region) { conditions.push(`region = $${i++}`); params.push(region); }
      if (status) { conditions.push(`status = $${i++}`); params.push(status); }
      if (type)   { conditions.push(`office_type = $${i++}`); params.push(type); }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const { rows } = await db.query(
        `SELECT office_id, office_code, name, region, address,
                gps_lat, gps_lng, office_type, status,
                config_version, config_updated_at, manager_id
         FROM offices ${where}
         ORDER BY created_at DESC
         LIMIT $${i++} OFFSET $${i++}`,
        [...params, limit, offset]
      );

      const { rows: [{ count }] } = await db.query(
        `SELECT COUNT(*) FROM offices ${where}`, params
      );

      res.json({
        success: true,
        data:    rows,
        total:   parseInt(count),
        page:    Number(page),
        limit:   Number(limit),
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ================================================================
// GET /offices/:id — Full office detail
// ================================================================
router.get('/:id',
  authenticate,
  async (req: any, res) => {
    try {
      // Check Redis cache first
      const cached = await redis.get(`office:${req.params.id}:capabilities`);

      const { rows: [office] } = await db.query(
        `SELECT o.*,
          (SELECT json_agg(z) FROM office_coverage_zones z WHERE z.office_id = o.office_id) as coverage_zones,
          (SELECT json_agg(r) FROM intercity_routes r WHERE r.origin_office_id = o.office_id) as intercity_routes
         FROM offices o WHERE o.office_id = $1`,
        [req.params.id]
      );

      if (!office) {
        return res.status(404).json({ success: false, message: 'OFFICE_001: Office not found' });
      }

      // Cache capabilities
      if (!cached) {
        await redis.setEx(
          `office:${req.params.id}:capabilities`,
          3600,
          JSON.stringify(office.capabilities)
        );
      }

      res.json({ success: true, data: office });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ================================================================
// PATCH /offices/:id — Update config
// ================================================================
router.patch('/:id',
  authenticate,
  requireRole(UserRole.BRANCH_MANAGER, UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const { rows: [current] } = await db.query(
        'SELECT * FROM offices WHERE office_id = $1', [req.params.id]
      );
      if (!current) {
        return res.status(404).json({ success: false, message: 'OFFICE_001: Office not found' });
      }

      const updates: string[] = [];
      const params: any[] = [];
      let i = 1;

      const allowed = ['operating_hours', 'sla_config', 'pricing_overrides', 'address', 'name'];
      for (const field of allowed) {
        if (req.body[field] !== undefined) {
          const value = typeof req.body[field] === 'object'
            ? JSON.stringify(req.body[field])
            : req.body[field];
          updates.push(`${field} = $${i++}`);
          params.push(value);
        }
      }

      if (updates.length === 0) {
        return res.status(400).json({ success: false, message: 'No valid fields to update' });
      }

      updates.push(`config_version = config_version + 1`);
      updates.push(`config_updated_at = NOW()`);
      updates.push(`updated_at = NOW()`);

      params.push(req.params.id);

      const { rows: [updated] } = await db.query(
        `UPDATE offices SET ${updates.join(', ')} WHERE office_id = $${i} RETURNING *`,
        params
      );

      // Invalidate Redis cache
      await redis.del(`office:${req.params.id}:capabilities`);

      // Audit log
      await db.query(
        `INSERT INTO audit_log (actor_id, actor_role, action, entity_type, entity_id, before_state, after_state)
         VALUES ($1, $2, 'OFFICE_CONFIG_UPDATED', 'offices', $3, $4, $5)`,
        [req.actor.user_id, req.actor.role, req.params.id,
         JSON.stringify(current), JSON.stringify(updated)]
      );

      await publishEvent('office.management', {
        event:     'OFFICE_CONFIG_UPDATED',
        office_id: req.params.id,
        payload:   { before: current, after: updated },
        timestamp: new Date().toISOString(),
        service:   'office-service',
      });

      res.json({ success: true, data: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ================================================================
// PATCH /offices/:id/capabilities — Toggle a single capability flag
// ================================================================
router.patch('/:id/capabilities',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const { flag, value, reason } = z.object({
        flag:   z.string().min(1),
        value:  z.boolean(),
        reason: z.string().min(10),
      }).parse(req.body);

      const { rows: [office] } = await db.query(
        'SELECT * FROM offices WHERE office_id = $1', [req.params.id]
      );
      if (!office) {
        return res.status(404).json({ success: false, message: 'OFFICE_001: Office not found' });
      }

      // Prerequisites check
      if (value) {
        if (flag === 'has_pickup_riders') {
          const { rows } = await db.query(
            `SELECT zone_id FROM office_coverage_zones
             WHERE office_id=$1 AND zone_type='PICKUP' AND is_active=true`,
            [req.params.id]
          );
          if (rows.length === 0) {
            return res.status(400).json({
              success: false,
              message: 'Cannot enable pickup riders — no PICKUP coverage zone exists'
            });
          }
        }

        if (flag === 'has_last_mile_delivery_riders') {
          const { rows } = await db.query(
            `SELECT zone_id FROM office_coverage_zones
             WHERE office_id=$1 AND zone_type='DELIVERY' AND is_active=true`,
            [req.params.id]
          );
          if (rows.length === 0) {
            return res.status(400).json({
              success: false,
              message: 'Cannot enable delivery riders — no DELIVERY coverage zone exists'
            });
          }
        }

        if (flag === 'has_intercity_dispatch') {
          const { rows } = await db.query(
            `SELECT route_id FROM intercity_routes
             WHERE origin_office_id=$1 AND is_active=true`,
            [req.params.id]
          );
          if (rows.length === 0) {
            return res.status(400).json({
              success: false,
              message: 'Cannot enable intercity dispatch — no active routes from this office'
            });
          }
        }

        if (flag === 'has_intercity_receiving') {
          const { rows } = await db.query(
            `SELECT route_id FROM intercity_routes
             WHERE dest_office_id=$1 AND is_active=true`,
            [req.params.id]
          );
          if (rows.length === 0) {
            return res.status(400).json({
              success: false,
              message: 'Cannot enable intercity receiving — no active routes to this office'
            });
          }
        }
      }

      const capabilities = { ...office.capabilities, [flag]: value };

      await db.query(
        `UPDATE offices
         SET capabilities=$1, config_version=config_version+1, config_updated_at=NOW(), updated_at=NOW()
         WHERE office_id=$2`,
        [JSON.stringify(capabilities), req.params.id]
      );

      // IMMEDIATELY invalidate cache — do not wait for TTL
      await redis.del(`office:${req.params.id}:capabilities`);

      // Audit log
      await db.query(
        `INSERT INTO audit_log (actor_id, actor_role, action, entity_type, entity_id, before_state, after_state)
         VALUES ($1, $2, 'OFFICE_CAPABILITY_TOGGLED', 'offices', $3, $4, $5)`,
        [req.actor.user_id, req.actor.role, req.params.id,
         JSON.stringify({ flag, old_value: office.capabilities[flag] }),
         JSON.stringify({ flag, new_value: value, reason })]
      );

      await publishEvent('office.management', {
        event:     'OFFICE_CAPABILITY_TOGGLED',
        office_id: req.params.id,
        payload:   { flag, value, reason },
        timestamp: new Date().toISOString(),
        service:   'office-service',
      });

      res.json({ success: true, data: { flag, value, reason } });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ================================================================
// PATCH /offices/:id/activate — Go live
// ================================================================
router.patch('/:id/activate',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const { rows: [office] } = await db.query(
        'SELECT * FROM offices WHERE office_id = $1', [req.params.id]
      );
      if (!office) return res.status(404).json({ success: false, message: 'OFFICE_001: Not found' });
      if (office.status !== 'SETUP') {
        return res.status(400).json({ success: false, message: 'Only SETUP offices can be activated' });
      }

      // Validate prerequisites
      if (!office.manager_id) {
        return res.status(400).json({ success: false, message: 'Manager must be assigned before activation' });
      }

      const { rows: zones } = await db.query(
        'SELECT zone_id FROM office_coverage_zones WHERE office_id=$1 AND is_active=true',
        [req.params.id]
      );
      if (zones.length === 0) {
        return res.status(400).json({ success: false, message: 'At least one coverage zone required' });
      }

      const { rows: [updated] } = await db.query(
        `UPDATE offices SET status='ACTIVE', updated_at=NOW()
         WHERE office_id=$1 RETURNING *`,
        [req.params.id]
      );

      await publishEvent('office.management', {
        event:     'OFFICE_ACTIVATED',
        office_id: req.params.id,
        timestamp: new Date().toISOString(),
        service:   'office-service',
      });

      res.json({ success: true, data: { office_id: req.params.id, status: 'ACTIVE' } });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ================================================================
// PATCH /offices/:id/suspend
// ================================================================
router.patch('/:id/suspend',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const { reason } = z.object({ reason: z.string().min(5) }).parse(req.body);

      await db.query(
        `UPDATE offices SET status='SUSPENDED', updated_at=NOW() WHERE office_id=$1`,
        [req.params.id]
      );

      await db.query(
        `INSERT INTO audit_log (actor_id, actor_role, action, entity_type, entity_id, after_state)
         VALUES ($1,$2,'OFFICE_SUSPENDED','offices',$3,$4)`,
        [req.actor.user_id, req.actor.role, req.params.id, JSON.stringify({ reason })]
      );

      await publishEvent('office.management', {
        event: 'OFFICE_SUSPENDED', office_id: req.params.id,
        payload: { reason }, timestamp: new Date().toISOString(), service: 'office-service',
      });

      res.json({ success: true, data: { office_id: req.params.id, status: 'SUSPENDED' } });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ================================================================
// PATCH /offices/:id/close — Begin closing
// ================================================================
router.patch('/:id/close',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      await db.query(
        `UPDATE offices SET status='CLOSING', updated_at=NOW() WHERE office_id=$1`,
        [req.params.id]
      );

      await publishEvent('office.management', {
        event: 'OFFICE_CLOSING', office_id: req.params.id,
        timestamp: new Date().toISOString(), service: 'office-service',
      });

      res.json({ success: true, data: { office_id: req.params.id, status: 'CLOSING' } });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ================================================================
// PATCH /offices/:id/finalize-close — Complete closing
// ================================================================
router.patch('/:id/finalize-close',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      // Check zero in-progress parcels
      const { rows: [{ count }] } = await db.query(
        `SELECT COUNT(*) FROM parcels
         WHERE (origin_office_id=$1 OR dest_office_id=$1)
         AND parcel_id NOT IN (
           SELECT DISTINCT parcel_id FROM parcel_events
           WHERE event_type IN ('PARCEL_DELIVERY_CONFIRMED','PARCEL_RETURN_DELIVERED_TO_SENDER','PARCEL_CANCELLED')
         )`,
        [req.params.id]
      );

      if (parseInt(count) > 0) {
        return res.status(400).json({
          success: false,
          message: `Cannot close — ${count} parcels still in progress at this office`
        });
      }

      await db.query(
        `UPDATE offices SET status='CLOSED', updated_at=NOW() WHERE office_id=$1`,
        [req.params.id]
      );

      // Remove from Redis GEO
      await redis.zRem('geo:offices', req.params.id);

      await publishEvent('office.management', {
        event: 'OFFICE_CLOSED', office_id: req.params.id,
        timestamp: new Date().toISOString(), service: 'office-service',
      });

      res.json({ success: true, data: { office_id: req.params.id, status: 'CLOSED' } });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

export default router;