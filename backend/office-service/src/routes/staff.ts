import { Router }  from 'express';
import { z }       from 'zod';
import { db }      from '../db';
import { authenticate, requireRole } from '../middleware';
import { UserRole } from '@flexbox/types';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// POST /staff/assign
// Assign a user to an office with one or more roles
// ─────────────────────────────────────────────────────────────────────────────
router.post('/assign',
  authenticate,
  requireRole(UserRole.OFFICE_MANAGER, UserRole.BRANCH_MANAGER, UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const body = z.object({
        user_id:   z.string().uuid(),
        office_id: z.string().uuid(),
        roles:     z.array(z.string()).min(1),
      }).parse(req.body);

      // Check user exists
      const { rows: [user] } = await db.query(
        'SELECT user_id, role FROM app_users WHERE user_id = $1 AND is_active = true',
        [body.user_id]
      );
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found or inactive' });
      }

      // Upsert staff assignment
      await db.query(
        `INSERT INTO staff_assignments (user_id, office_id, roles, is_active, assigned_by)
         VALUES ($1, $2, $3::text[], true, $4)
         ON CONFLICT (user_id, office_id)
         DO UPDATE SET roles = $3::text[], is_active = true, assigned_by = $4, updated_at = NOW()`,
        [body.user_id, body.office_id, body.roles, req.actor.user_id]
      );

      res.json({
        success: true,
        message: 'Staff assigned to office',
        data: { user_id: body.user_id, office_id: body.office_id, roles: body.roles },
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /staff/office/:officeId
// List all staff at an office
// ─────────────────────────────────────────────────────────────────────────────
router.get('/office/:officeId',
  authenticate,
  requireRole(UserRole.OFFICE_MANAGER, UserRole.BRANCH_MANAGER, UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const { rows } = await db.query(
        `SELECT
           sa.assignment_id, sa.roles, sa.is_active, sa.assigned_at,
           u.user_id, u.full_name, u.phone, u.role as primary_role
         FROM staff_assignments sa
         JOIN app_users u ON u.user_id = sa.user_id
         WHERE sa.office_id = $1 AND sa.is_active = true
         ORDER BY u.full_name ASC`,
        [req.params.officeId]
      );
      res.json({ success: true, data: rows });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /staff/dual-role
// Approve dual role for a user (e.g. rider + agent at same time)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/dual-role',
  authenticate,
  requireRole(UserRole.OFFICE_MANAGER, UserRole.BRANCH_MANAGER, UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const { user_id, additional_role, office_id } = z.object({
        user_id:         z.string().uuid(),
        additional_role: z.string(),
        office_id:       z.string().uuid(),
      }).parse(req.body);

      // Get current assignment
      const { rows: [assignment] } = await db.query(
        'SELECT * FROM staff_assignments WHERE user_id = $1 AND office_id = $2',
        [user_id, office_id]
      );

      if (!assignment) {
        return res.status(404).json({ success: false, message: 'Staff assignment not found' });
      }

      const newRoles = Array.from(new Set([...assignment.roles, additional_role]));

      await db.query(
        `UPDATE staff_assignments SET roles = $1::text[], updated_at = NOW()
         WHERE user_id = $2 AND office_id = $3`,
        [newRoles, user_id, office_id]
      );

      res.json({
        success: true,
        message: `Dual role approved. User can now act as: ${newRoles.join(', ')}`,
        data: { user_id, roles: newRoles },
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /staff/transfer
// Transfer a rider from one office to another
// All active jobs must be complete before transfer
// ─────────────────────────────────────────────────────────────────────────────
router.post('/transfer',
  authenticate,
  requireRole(UserRole.BRANCH_MANAGER, UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const { user_id, from_office_id, to_office_id, reason, force } = z.object({
        user_id:        z.string().uuid(),
        from_office_id: z.string().uuid(),
        to_office_id:   z.string().uuid(),
        reason:         z.string().min(5),
        force:          z.boolean().default(false), // emergency transfer
      }).parse(req.body);

      // Check active jobs unless forced
      if (!force) {
        const { rows: [{ count }] } = await db.query(
          `SELECT COUNT(*) FROM rider_jobs
           WHERE rider_id = (SELECT rider_id FROM riders WHERE user_id = $1)
             AND status IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED')`,
          [user_id]
        );
        if (parseInt(count) > 0) {
          return res.status(400).json({
            success: false,
            message: `Cannot transfer — ${count} active job(s) must complete first. Use force=true for emergency.`,
          });
        }
      }

      // Update riders table
      await db.query(
        `UPDATE riders SET assigned_office_id = $1 WHERE user_id = $2`,
        [to_office_id, user_id]
      );

      // Update staff assignment
      await db.query(
        `UPDATE staff_assignments SET is_active = false WHERE user_id = $1 AND office_id = $2`,
        [user_id, from_office_id]
      );
      await db.query(
        `INSERT INTO staff_assignments (user_id, office_id, roles, is_active, assigned_by)
         VALUES ($1, $2, ARRAY['RIDER'], true, $3)
         ON CONFLICT (user_id, office_id)
         DO UPDATE SET is_active = true, assigned_by = $3, updated_at = NOW()`,
        [user_id, to_office_id, req.actor.user_id]
      );

      // Audit log
      await db.query(
        `INSERT INTO audit_log (actor_id, actor_role, action, entity_type, entity_id, after_state)
         VALUES ($1, $2, 'RIDER_TRANSFERRED', 'staff_assignments', $3, $4)`,
        [
          req.actor.user_id, req.actor.role, user_id,
          JSON.stringify({ from_office_id, to_office_id, reason, forced: force }),
        ]
      );

      res.json({
        success: true,
        message: `Rider transferred from ${from_office_id} to ${to_office_id}`,
        data: { user_id, from_office_id, to_office_id, forced: force },
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /staff/remove
// Remove a staff member from an office
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/remove',
  authenticate,
  requireRole(UserRole.OFFICE_MANAGER, UserRole.BRANCH_MANAGER, UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const { user_id, office_id } = z.object({
        user_id:   z.string().uuid(),
        office_id: z.string().uuid(),
      }).parse(req.body);

      await db.query(
        `UPDATE staff_assignments SET is_active = false, updated_at = NOW()
         WHERE user_id = $1 AND office_id = $2`,
        [user_id, office_id]
      );

      res.json({ success: true, message: 'Staff removed from office' });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

export default router;
