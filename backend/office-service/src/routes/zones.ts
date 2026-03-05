import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { redis } from '../redis';
import { authenticate, requireRole } from '../middleware';
import { UserRole } from '@flexbox/types';

const router = Router({ mergeParams: true });

// POST /offices/:id/zones — Add coverage zone
router.post('/',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const body = z.object({
        zone_type: z.enum(['PICKUP', 'DELIVERY']),
        polygon:   z.object({
          type:        z.literal('Polygon'),
          coordinates: z.array(z.array(z.array(z.number()))).min(1),
        }),
        notes: z.string().optional(),
      }).parse(req.body);

      // Validate polygon closes (first and last coordinate must match)
      const coords = body.polygon.coordinates[0];
      if (coords.length < 4) {
        return res.status(400).json({
          success: false,
          message: 'Polygon must have at least 4 coordinate pairs'
        });
      }
      const first = coords[0];
      const last  = coords[coords.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        return res.status(400).json({
          success: false,
          message: 'Polygon must be closed — first and last coordinates must match'
        });
      }

      const { rows: [zone] } = await db.query(
        `INSERT INTO office_coverage_zones (office_id, zone_type, polygon, notes, is_active)
         VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), $4, true)
         RETURNING zone_id, office_id, zone_type, is_active, notes`,
        [req.params.id, body.zone_type, JSON.stringify(body.polygon), body.notes || null]
      );

      // Invalidate covering cache for this office region
      // (simplified — in production you'd invalidate by bbox)
      await redis.del(`office:${req.params.id}:capabilities`);

      res.status(201).json({ success: true, data: zone });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// GET /offices/:id/zones — List coverage zones
router.get('/', authenticate, async (req: any, res) => {
  try {
    const { rows } = await db.query(
      `SELECT zone_id, office_id, zone_type, is_active, notes,
              ST_AsGeoJSON(polygon) as polygon_geojson
       FROM office_coverage_zones
       WHERE office_id = $1`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PATCH /offices/:id/zones/:zone_id — Toggle active
router.patch('/:zone_id',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const { is_active } = z.object({ is_active: z.boolean() }).parse(req.body);
      await db.query(
        'UPDATE office_coverage_zones SET is_active=$1 WHERE zone_id=$2 AND office_id=$3',
        [is_active, req.params.zone_id, req.params.id]
      );
      await redis.del(`office:${req.params.id}:capabilities`);
      res.json({ success: true, data: { zone_id: req.params.zone_id, is_active } });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

export default router;