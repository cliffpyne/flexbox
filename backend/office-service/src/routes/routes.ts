import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { authenticate, requireRole } from '../middleware';
import { UserRole } from '@flexbox/types';

const router = Router({ mergeParams: true });

// POST /offices/:id/routes — Add intercity route
router.post('/',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const body = z.object({
        dest_office_id:          z.string().uuid(),
        departure_days:          z.array(z.enum(['MON','TUE','WED','THU','FRI','SAT','SUN'])),
        departure_time:          z.string().regex(/^\d{2}:\d{2}$/),
        transit_hours:           z.number().positive(),
        transport_type:          z.enum(['BUS','OWN_VEHICLE','THIRD_PARTY_COURIER']),
        courier_partner:         z.string().optional(),
        max_boxes:               z.number().positive(),
        min_fill_threshold_pct:  z.number().min(0).max(100).default(30),
      }).parse(req.body);

      const { rows: [route] } = await db.query(
        `INSERT INTO intercity_routes (
          origin_office_id, dest_office_id, route_code,
          departure_schedules, estimated_hours, transport_type,
          max_boxes, is_active
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,false)
        RETURNING *`,
        [
          req.params.id,
          body.dest_office_id,
          `${req.params.id}-${body.dest_office_id}`,
          JSON.stringify({
            days: body.departure_days,
            time: body.departure_time,
            courier_partner: body.courier_partner,
            min_fill_threshold_pct: body.min_fill_threshold_pct,
            max_boxes: body.max_boxes,
          }),
          body.transit_hours,
          body.transport_type,
          body.max_boxes,
        ]
      );

      res.status(201).json({ success: true, data: route });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// GET /offices/:id/routes — List routes for this office
router.get('/', authenticate, async (req: any, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.*,
         o.name as dest_office_name,
         o.region as dest_region
       FROM intercity_routes r
       JOIN offices o ON o.office_id = r.dest_office_id
       WHERE r.origin_office_id = $1
       ORDER BY r.created_at DESC`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// GET /offices/route?origin_id=&dest_id= — Route between two offices
router.get('/between', authenticate, async (req: any, res) => {
  try {
    const { origin_id, dest_id } = req.query;
    const { rows } = await db.query(
      `SELECT r.*,
         o.name as dest_office_name
       FROM intercity_routes r
       JOIN offices o ON o.office_id = r.dest_office_id
       WHERE r.origin_office_id=$1
         AND r.dest_office_id=$2
         AND r.is_active=true`,
      [origin_id, dest_id]
    );
    res.json({ success: true, data: rows });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PATCH /offices/routes/:route_id — Update route
router.patch('/routes/:route_id',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const { is_active, max_boxes, transit_hours } = req.body;
      const updates: string[] = [];
      const params: any[] = [];
      let i = 1;

      if (is_active !== undefined) { updates.push(`is_active=$${i++}`); params.push(is_active); }
      if (max_boxes)    { updates.push(`max_boxes=$${i++}`);    params.push(max_boxes); }
      if (transit_hours){ updates.push(`estimated_hours=$${i++}`); params.push(transit_hours); }

      if (!updates.length) return res.status(400).json({ success: false, message: 'Nothing to update' });

      params.push(req.params.route_id);
      await db.query(
        `UPDATE intercity_routes SET ${updates.join(',')} WHERE route_id=$${i}`,
        params
      );

      res.json({ success: true, message: 'Route updated' });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

export default router;