import { Router }    from 'express';
import { z }         from 'zod';
import bcrypt        from 'bcrypt';
import speakeasy     from 'speakeasy';
import QRCode        from 'qrcode';
import { db }        from '../db';
import { redis }     from '../redis';
import { authenticate, requireRole } from '../middleware';
import { UserRole }  from '@flexbox/types';
import { generateUsername } from '../lib/username';
import { generatePassword, hashPassword } from '../lib/password';
import { sendSMS, smsWelcomeStaff }   from '../lib/sms';
import {
  createStaffUser,
  deactivateUser,
  saveDocument,
} from '../repos/users.repo';
import { revokeAllUserTokens } from '../repos/tokens.repo';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────
// SHARED: create any staff account
// Generates username + password, stores, sends SMS to their phone
// ─────────────────────────────────────────────────────────────────────────
async function createStaffAccount(params: {
  phone:        string;
  full_name:    string;
  role:         string;
  office_id?:   string;
  nida_number?: string;
  created_by:   string;
}) {
  const username      = await generateUsername();
  const rawPassword   = generatePassword();
  const password_hash = await hashPassword(rawPassword);

  const user = await createStaffUser({
    phone:                params.phone,
    full_name:            params.full_name,
    username,
    password_hash,
    role:                 params.role,
    office_id:            params.office_id,
    nida_number:          params.nida_number,
    created_by:           params.created_by,
    must_change_password: true, // FORCED on first login
  });

  // Send credentials to user via SMS
  await sendSMS(params.phone, smsWelcomeStaff({
    full_name: params.full_name,
    username,
    password:  rawPassword,
    role:      params.role,
  }));

  return { user, username };
}

// ─────────────────────────────────────────────────────────────────────────
// POST /admin/riders
// Branch Manager or Ops Admin creates a rider account
// ─────────────────────────────────────────────────────────────────────────
router.post('/riders',
  authenticate,
  requireRole(UserRole.BRANCH_MANAGER, UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const body = z.object({
        phone:        z.string().min(10),
        full_name:    z.string().min(2),
        nida_number:  z.string().min(8),
        vehicle_type: z.string().optional(),
        plate_number: z.string().optional(),
        office_id:    z.string().uuid().optional(),
      }).parse(req.body);

      // office_id: use caller's office if not specified
      const office_id = body.office_id || req.actor.office_id;
      if (!office_id) {
        return res.status(400).json({
          success: false,
          message: 'office_id is required',
        });
      }

      const { user } = await createStaffAccount({
        phone:       body.phone,
        full_name:   body.full_name,
        role:        UserRole.RIDER,
        office_id,
        nida_number: body.nida_number,
        created_by:  req.actor.user_id,
      });

      // Create riders table entry
      await db.query(
        `INSERT INTO riders
           (user_id, assigned_office_id, vehicle_type, plate_number)
         VALUES ($1, $2, $3, $4)`,
        [user.user_id, office_id,
         body.vehicle_type || 'MOTORCYCLE', body.plate_number || null]
      );

      res.json({
        success: true,
        message: `Rider account created. Credentials sent to ${body.phone}.`,
        data: {
          user_id:  user.user_id,
          username: user.username,
          phone:    user.phone,
          role:     user.role,
        },
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────
// POST /admin/office-workers
// Office Manager, Branch Manager, or Ops Admin creates an office worker
// ─────────────────────────────────────────────────────────────────────────
router.post('/office-workers',
  authenticate,
  requireRole(
    UserRole.OFFICE_MANAGER, UserRole.BRANCH_MANAGER,
    UserRole.OPS_ADMIN,      UserRole.SUPER_ADMIN
  ),
  async (req: any, res) => {
    try {
      const body = z.object({
        phone:       z.string().min(10),
        full_name:   z.string().min(2),
        nida_number: z.string().min(8),
        role:        z.enum(['OFFICE_WORKER', 'OFFICE_MANAGER']),
        office_id:   z.string().uuid().optional(),
      }).parse(req.body);

      const office_id = body.office_id || req.actor.office_id;
      if (!office_id) {
        return res.status(400).json({
          success: false, message: 'office_id is required',
        });
      }

      const { user } = await createStaffAccount({
        phone:       body.phone,
        full_name:   body.full_name,
        role:        body.role,
        office_id,
        nida_number: body.nida_number,
        created_by:  req.actor.user_id,
      });

      res.json({
        success: true,
        message: `Account created. Credentials sent to ${body.phone}.`,
        data: {
          user_id:  user.user_id,
          username: user.username,
          phone:    user.phone,
          role:     user.role,
        },
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────
// POST /admin/agents
// Ops Admin or Super Admin creates an agent account
// Agent comes to office, office captures their documents
// ─────────────────────────────────────────────────────────────────────────
router.post('/agents',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const body = z.object({
        phone:           z.string().min(10),
        full_name:       z.string().min(2),
        nida_number:     z.string().min(8),
        commission_rate: z.number().min(0).max(1).default(0.05),
        home_office_id:  z.string().uuid(),
      }).parse(req.body);

      const { user } = await createStaffAccount({
        phone:       body.phone,
        full_name:   body.full_name,
        role:        UserRole.AGENT,
        office_id:   body.home_office_id,
        nida_number: body.nida_number,
        created_by:  req.actor.user_id,
      });

      // Create agents table entry
      await db.query(
        `INSERT INTO agents
           (user_id, home_office_id, commission_rate, status)
         VALUES ($1, $2, $3, 'ACTIVE')`,
        [user.user_id, body.home_office_id, body.commission_rate]
      );

      res.json({
        success: true,
        message: `Agent account created. Credentials sent to ${body.phone}.`,
        data: {
          user_id:  user.user_id,
          username: user.username,
          phone:    user.phone,
          role:     user.role,
        },
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────
// POST /admin/managers
// Ops Admin or Super Admin creates Branch Manager, Support, Pricing Manager
// ─────────────────────────────────────────────────────────────────────────
router.post('/managers',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const body = z.object({
        phone:     z.string().min(10),
        full_name: z.string().min(2),
        role: z.enum([
          'BRANCH_MANAGER', 'SUPPORT_T1', 'SUPPORT_T2',
          'PRICING_MANAGER', 'OPS_ADMIN',
        ]),
        office_id:   z.string().uuid().optional(),
        nida_number: z.string().optional(),
      }).parse(req.body);

      const { user } = await createStaffAccount({
        phone:       body.phone,
        full_name:   body.full_name,
        role:        body.role,
        office_id:   body.office_id,
        nida_number: body.nida_number,
        created_by:  req.actor.user_id,
      });

      res.json({
        success: true,
        message: `${body.role.replace(/_/g,' ')} account created. Credentials sent to ${body.phone}.`,
        data: {
          user_id:  user.user_id,
          username: user.username,
          phone:    user.phone,
          role:     user.role,
        },
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────
// POST /admin/documents
// Upload a document for a user (NIDA photo, license etc)
// ─────────────────────────────────────────────────────────────────────────
router.post('/documents',
  authenticate,
  requireRole(
    UserRole.OFFICE_MANAGER, UserRole.BRANCH_MANAGER,
    UserRole.OPS_ADMIN,      UserRole.SUPER_ADMIN
  ),
  async (req: any, res) => {
    try {
      const body = z.object({
        user_id:    z.string().uuid(),
        doc_type:   z.enum(['NIDA', 'DRIVERS_LICENSE', 'PASSPORT', 'OTHER']),
        doc_number: z.string().min(1),
        doc_url:    z.string().url(),
      }).parse(req.body);

      await saveDocument({
        ...body,
        uploaded_by: req.actor.user_id,
      });

      res.json({ success: true, message: 'Document saved.' });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────
// PATCH /admin/users/:id/deactivate
// Suspend a user account
// ─────────────────────────────────────────────────────────────────────────
router.patch('/users/:id/deactivate',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      await deactivateUser(req.params.id);
      await revokeAllUserTokens(req.params.id);
      // Revoke session in Redis
      await redis.setEx(`session:active:${req.params.id}`, 900, '0');
      res.json({ success: true, message: 'User deactivated.' });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────
// POST /admin/setup-totp
// Ops Admin and Super Admin setup Google Authenticator
// ─────────────────────────────────────────────────────────────────────────
router.post('/setup-totp',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const secret = speakeasy.generateSecret({
        name: `FlexSend (${req.actor.user_id})`,
      });

      await db.query(
        'UPDATE app_users SET totp_secret = $1 WHERE user_id = $2',
        [secret.base32, req.actor.user_id]
      );

      const qrCode = await QRCode.toDataURL(secret.otpauth_url!);

      res.json({
        success: true,
        data: {
          secret:  secret.base32,
          qr_code: qrCode,
          message: 'Scan QR with Google Authenticator',
        },
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

export default router;
