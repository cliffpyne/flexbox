import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { authenticate, requireRole } from '../middleware';
import { publishEvent } from '../qstash';
import { UserRole } from '@flexbox/types';

const router = Router();

// POST /offices/boxes — Register new GPS box
router.post('/',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const body = z.object({
        gps_device_id:  z.string().length(15, 'IMEI must be exactly 15 digits'),
        box_serial:     z.string().regex(/^SND-BOX-\d{4}$/, 'Must match SND-BOX-XXXX'),
        size_class:     z.enum(['S','M','L','XL']),
        home_office_id: z.string().uuid(),
      }).parse(req.body);

      // Verify home office is ACTIVE
      const { rows: [office] } = await db.query(
        'SELECT status FROM offices WHERE office_id=$1', [body.home_office_id]
      );
      if (!office || office.status !== 'ACTIVE') {
        return res.status(400).json({ success: false, message: 'BOX_001: Home office must be ACTIVE' });
      }

      const { rows: [box] } = await db.query(
        `INSERT INTO boxes (gps_device_id, box_serial, size_class, home_office_id, current_office_id, status)
         VALUES ($1,$2,$3,$4,$4,'AVAILABLE') RETURNING *`,
        [body.gps_device_id, body.box_serial, body.size_class, body.home_office_id]
      );

      res.status(201).json({ success: true, data: box });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// GET /offices/:id/boxes — All boxes at this office
router.get('/at/:office_id',
  authenticate,
  async (req: any, res) => {
    try {
      const { status, size_class } = req.query;
      const conditions = ['current_office_id=$1'];
      const params: any[] = [req.params.office_id];
      let i = 2;

      if (status)     { conditions.push(`status=$${i++}`);     params.push(status); }
      if (size_class) { conditions.push(`size_class=$${i++}`); params.push(size_class); }

      const { rows } = await db.query(
        `SELECT * FROM boxes WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
        params
      );
      res.json({ success: true, data: rows });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// GET /offices/boxes/:box_id — Single box detail
router.get('/:box_id', authenticate, async (req: any, res) => {
  try {
    const { rows: [box] } = await db.query(
      'SELECT * FROM boxes WHERE box_id=$1', [req.params.box_id]
    );
    if (!box) return res.status(404).json({ success: false, message: 'BOX_001: Box not found' });
    res.json({ success: true, data: box });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PATCH /offices/boxes/:box_id/transfer — Move to another office
router.patch('/:box_id/transfer',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const { destination_office_id, reason } = z.object({
        destination_office_id: z.string().uuid(),
        reason:                z.string().min(5),
      }).parse(req.body);

      await db.query(
        `UPDATE boxes SET current_office_id=$1, updated_at=NOW() WHERE box_id=$2`,
        [destination_office_id, req.params.box_id]
      );

      await db.query(
        `INSERT INTO audit_log (actor_id, actor_role, action, entity_type, entity_id, after_state)
         VALUES ($1,$2,'BOX_TRANSFERRED','boxes',$3,$4)`,
        [req.actor.user_id, req.actor.role, req.params.box_id,
         JSON.stringify({ destination_office_id, reason })]
      );

      res.json({ success: true, message: 'Box transferred' });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// POST /offices/boxes/:box_id/abnormality — Report issue
router.post('/:box_id/abnormality',
  authenticate,
  requireRole(UserRole.OFFICE_WORKER, UserRole.OFFICE_MANAGER, UserRole.OPS_ADMIN),
  async (req: any, res) => {
    try {
      const body = z.object({
        issue_flags: z.array(z.string()).min(1),
        notes:       z.string().optional(),
        photo_url:   z.string().optional(),
      }).parse(req.body);

      // Immediately set DAMAGED — remove from available pool
      await db.query(
        `UPDATE boxes
         SET status='DAMAGED',
             condition_flags=$1,
             updated_at=NOW()
         WHERE box_id=$2`,
        [JSON.stringify({ is_damaged: true, flags: body.issue_flags, notes: body.notes }), req.params.box_id]
      );

      await publishEvent('box.abnormality', {
        event:     'BOX_ABNORMALITY_REPORTED',
        box_id:    req.params.box_id,
        payload:   body,
        timestamp: new Date().toISOString(),
        service:   'office-service',
      });

      res.json({ success: true, message: 'Box marked as DAMAGED — removed from available pool' });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// PATCH /offices/boxes/:box_id/restore — Mark repaired
router.patch('/:box_id/restore',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const { resolution_notes } = z.object({
        resolution_notes: z.string().min(5)
      }).parse(req.body);

      await db.query(
        `UPDATE boxes
         SET status='AVAILABLE',
             condition_flags='{"is_damaged":false,"is_tampered":false,"needs_repair":false,"is_clean":true}',
             updated_at=NOW()
         WHERE box_id=$1`,
        [req.params.box_id]
      );

      res.json({ success: true, message: 'Box restored to AVAILABLE' });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// PATCH /offices/boxes/:box_id/retire — Permanently retire
router.patch('/:box_id/retire',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const { reason } = z.object({ reason: z.string().min(5) }).parse(req.body);

      await db.query(
        `UPDATE boxes SET status='RETIRED', updated_at=NOW() WHERE box_id=$1`,
        [req.params.box_id]
      );

      await publishEvent('box.management', {
        event:     'BOX_RETIRED',
        box_id:    req.params.box_id,
        payload:   { reason },
        timestamp: new Date().toISOString(),
        service:   'office-service',
      });

      res.json({ success: true, message: 'Box permanently retired' });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

export default router;