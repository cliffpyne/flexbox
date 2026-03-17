import { Router }  from 'express';
import { z }       from 'zod';
import { db }      from '../db';
import { redis }   from '../redis';
import { authenticate, requireRole } from '../middleware';
import { calculatePrice }            from '../services/pricing.service';
import { UserRole } from '@flexbox/types';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// POST /pricing/calculate
// Given parcel details → return full price breakdown
// Called by every booking flow and walk-in
// ─────────────────────────────────────────────────────────────────────────────
router.post('/calculate', authenticate, async (req: any, res) => {
  try {
    const body = z.object({
      declared_weight_kg:  z.number().positive(),
      declared_length_cm:  z.number().positive(),
      declared_width_cm:   z.number().positive(),
      declared_height_cm:  z.number().positive(),
      category:            z.enum(['DOCUMENTS','ELECTRONICS','CLOTHING','FOOD','FRAGILE','OTHER']),
      is_fragile:          z.boolean().default(false),
      origin_office_id:    z.string().uuid(),
      dest_office_id:      z.string().uuid(),
    }).parse(req.body);

    const breakdown = await calculatePrice(body as any);

    res.json({ success: true, data: breakdown });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /pricing/active
// Get the current active pricing version with all rates
// ─────────────────────────────────────────────────────────────────────────────
router.get('/active', authenticate, async (req: any, res) => {
  try {
    const { rows: [version] } = await db.query(
      `SELECT pv.*,
         json_agg(DISTINCT pz.*) as zones,
         json_agg(DISTINCT wb.*) as brackets,
         json_agg(DISTINCT cs.*) as surcharges
       FROM pricing_versions pv
       LEFT JOIN pricing_zones pz      ON pz.version_id = pv.version_id
       LEFT JOIN weight_brackets wb    ON wb.version_id = pv.version_id
       LEFT JOIN category_surcharges cs ON cs.version_id = pv.version_id
       WHERE pv.status = 'ACTIVE'
       GROUP BY pv.version_id`
    );

    if (!version) {
      return res.status(404).json({ success: false, message: 'No active pricing found' });
    }

    res.json({ success: true, data: version });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /pricing/versions
// List all pricing versions
// ─────────────────────────────────────────────────────────────────────────────
router.get('/versions',
  authenticate,
  requireRole(UserRole.PRICING_MANAGER, UserRole.BRANCH_MANAGER, UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const { rows } = await db.query(
        `SELECT pv.*,
           u1.full_name as created_by_name,
           u2.full_name as approved_by_name
         FROM pricing_versions pv
         LEFT JOIN app_users u1 ON u1.user_id = pv.created_by
         LEFT JOIN app_users u2 ON u2.user_id = pv.approved_by
         ORDER BY pv.created_at DESC`
      );
      res.json({ success: true, data: rows });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /pricing/versions
// Create a new pricing draft
// ─────────────────────────────────────────────────────────────────────────────
router.post('/versions',
  authenticate,
  requireRole(UserRole.PRICING_MANAGER, UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const body = z.object({
        label:  z.string().min(3),
        zones:  z.array(z.object({
          origin_region:   z.string(),
          dest_region:     z.string(),
          base_rate_per_kg: z.number().positive(),
        })).min(1),
        brackets: z.array(z.object({
        
          from_kg:          z.number().nonnegative(),
          to_kg:            z.number().positive(),
          rate_multiplier:  z.number().positive(),
        })).min(1),
        surcharges: z.array(z.object({
          category:         z.string(),
          fixed_amount_tzs: z.number().nonnegative(),
        })).optional(),
      }).parse(req.body);

      // Validate brackets don't overlap
      const sorted = [...body.brackets].sort((a, b) => a.from_kg - b.from_kg);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].from_kg < sorted[i-1].to_kg) {
          return res.status(400).json({
            success: false,
            message: `Weight brackets overlap: ${sorted[i-1].from_kg}-${sorted[i-1].to_kg} and ${sorted[i].from_kg}-${sorted[i].to_kg}`,
          });
        }
      }

      // Create version
      const { rows: [version] } = await db.query(
        `INSERT INTO pricing_versions (label, status, created_by)
         VALUES ($1, 'DRAFT', $2) RETURNING version_id`,
        [body.label, req.actor.user_id]
      );

      // Insert zones
      for (const zone of body.zones) {
        await db.query(
          `INSERT INTO pricing_zones (version_id, origin_region, dest_region, base_rate_per_kg)
           VALUES ($1, $2, $3, $4)`,
          [version.version_id, zone.origin_region, zone.dest_region, zone.base_rate_per_kg]
        );
      }

      // Insert brackets
      for (const bracket of body.brackets) {
        await db.query(
          `INSERT INTO weight_brackets (version_id, from_kg, to_kg, rate_multiplier)
           VALUES ($1, $2, $3, $4)`,
          [version.version_id, bracket.from_kg, bracket.to_kg, bracket.rate_multiplier]
        );
      }

      // Insert surcharges
      for (const surcharge of (body.surcharges ?? [])) {
        await db.query(
          `INSERT INTO category_surcharges (version_id, category, fixed_amount_tzs)
           VALUES ($1, $2, $3)`,
          [version.version_id, surcharge.category, surcharge.fixed_amount_tzs]
        );
      }

      res.status(201).json({
        success: true,
        data: { version_id: version.version_id, status: 'DRAFT', label: body.label },
        message: 'Pricing draft created. Submit for approval when ready.',
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /pricing/versions/:id/submit
// Submit draft for approval
// ─────────────────────────────────────────────────────────────────────────────
router.post('/versions/:id/submit',
  authenticate,
  requireRole(UserRole.PRICING_MANAGER, UserRole.OPS_ADMIN),
  async (req: any, res) => {
    try {
      const { rows: [version] } = await db.query(
        `UPDATE pricing_versions
         SET status = 'PENDING_APPROVAL', updated_at = NOW()
         WHERE version_id = $1 AND status = 'DRAFT' AND created_by = $2
         RETURNING version_id, label`,
        [req.params.id, req.actor.user_id]
      );

      if (!version) {
        return res.status(404).json({
          success: false,
          message: 'Draft not found or you are not the creator',
        });
      }

      res.json({ success: true, message: 'Submitted for approval', data: version });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /pricing/versions/:id/approve
// Approve and activate pricing — archives current active version
// ─────────────────────────────────────────────────────────────────────────────
router.post('/versions/:id/approve',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.BRANCH_MANAGER, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const { rows: [version] } = await db.query(
        `SELECT * FROM pricing_versions WHERE version_id = $1 AND status = 'PENDING_APPROVAL'`,
        [req.params.id]
      );
      if (!version) {
        return res.status(404).json({
          success: false,
          message: 'Version not found or not pending approval',
        });
      }

      // Archive current active version
      await db.query(
        `UPDATE pricing_versions SET status = 'ARCHIVED', updated_at = NOW()
         WHERE status = 'ACTIVE'`
      );

      // Activate new version
      await db.query(
        `UPDATE pricing_versions
         SET status = 'ACTIVE', approved_by = $1, activated_at = NOW(), updated_at = NOW()
         WHERE version_id = $2`,
        [req.actor.user_id, req.params.id]
      );

      // Invalidate pricing cache — all services will pick up new rates
      await redis.del('pricing:active');

      res.json({
        success: true,
        message: 'Pricing activated. All new bookings will use these rates.',
        data: { version_id: req.params.id, status: 'ACTIVE' },
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

export default router;
