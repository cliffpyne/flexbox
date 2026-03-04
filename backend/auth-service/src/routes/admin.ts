import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { db } from '../db';
import { redis } from '../redis';
import { authenticate, requireRole } from '../middleware';
import { UserRole, Permission } from '@flexbox/types';

const router = Router();

// POST /admin/riders — Branch Manager, Ops Admin
router.post('/riders',
  authenticate,
  requireRole(UserRole.BRANCH_MANAGER, UserRole.OPS_ADMIN),
  async (req: any, res) => {
    try {
      const { phone, full_name, pin, vehicle_type, plate_number } = z.object({
        phone:        z.string().min(10),
        full_name:    z.string().min(2),
        pin:          z.string().length(4),
        vehicle_type: z.string().optional(),
        plate_number: z.string().optional(),
      }).parse(req.body);

      const pin_hash = await bcrypt.hash(pin, 12);
      const office_id = req.actor.office_id;

      const { rows: [user] } = await db.query(
        `INSERT INTO app_users (phone, full_name, role, pin_hash, is_verified, is_active)
         VALUES ($1, $2, $3, $4, true, true) RETURNING *`,
        [phone, full_name, UserRole.RIDER, pin_hash]
      );

      await db.query(
        `INSERT INTO riders (user_id, assigned_office_id, vehicle_type, plate_number)
         VALUES ($1, $2, $3, $4)`,
        [user.user_id, office_id, vehicle_type || 'MOTORCYCLE', plate_number]
      );

      res.json({ success: true, data: { user_id: user.user_id, phone, full_name } });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// POST /admin/office-workers — Office Manager, Branch Manager
router.post('/office-workers',
  authenticate,
  requireRole(UserRole.OFFICE_MANAGER, UserRole.BRANCH_MANAGER, UserRole.OPS_ADMIN),
  async (req: any, res) => {
    try {
      const { phone, full_name, pin, role } = z.object({
        phone:     z.string().min(10),
        full_name: z.string().min(2),
        pin:       z.string().length(4),
        role:      z.enum(['OFFICE_WORKER', 'OFFICE_MANAGER']),
      }).parse(req.body);

      const pin_hash = await bcrypt.hash(pin, 12);

      const { rows: [user] } = await db.query(
        `INSERT INTO app_users (phone, full_name, role, pin_hash, is_verified, is_active)
         VALUES ($1, $2, $3, $4, true, true) RETURNING *`,
        [phone, full_name, role, pin_hash]
      );

      res.json({ success: true, data: { user_id: user.user_id, phone, full_name } });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// POST /admin/managers — Ops Admin, Super Admin
router.post('/managers',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const { phone, full_name, password, role, office_id } = z.object({
        phone:     z.string().min(10),
        full_name: z.string().min(2),
        password:  z.string().min(8),
        role:      z.enum([
          'OFFICE_MANAGER','BRANCH_MANAGER',
          'SUPPORT_AGENT','PRICING_MANAGER'
        ]),
        office_id: z.string().uuid().optional(),
      }).parse(req.body);

      const password_hash = await bcrypt.hash(password, 12);

      const { rows: [user] } = await db.query(
        `INSERT INTO app_users (phone, full_name, role, password_hash, is_verified, is_active)
         VALUES ($1, $2, $3, $4, true, true) RETURNING *`,
        [phone, full_name, role, password_hash]
      );

      res.json({ success: true, data: { user_id: user.user_id, phone, full_name, role } });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// POST /admin/reset-pin — Office Manager, Branch Manager
router.post('/reset-pin',
  authenticate,
  requireRole(UserRole.OFFICE_MANAGER, UserRole.BRANCH_MANAGER, UserRole.OPS_ADMIN),
  async (req: any, res) => {
    try {
      const { user_id, new_pin } = z.object({
        user_id: z.string().uuid(),
        new_pin: z.string().length(4),
      }).parse(req.body);

      const pin_hash = await bcrypt.hash(new_pin, 12);

      await db.query(
        'UPDATE app_users SET pin_hash=$1 WHERE user_id=$2',
        [pin_hash, user_id]
      );

      // Clear any lockout
      await redis.del(`pin_attempts:${user_id}`);

      res.json({ success: true, message: 'PIN reset successfully' });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// PATCH /admin/users/:id/deactivate — Ops Admin, Super Admin
router.patch('/users/:id/deactivate',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      await db.query(
        'UPDATE app_users SET is_active=false WHERE user_id=$1',
        [req.params.id]
      );
      res.json({ success: true, message: 'User deactivated' });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

// POST /admin/setup-totp — for OPS_ADMIN and SUPER_ADMIN
router.post('/setup-totp',
  authenticate,
  requireRole(UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN),
  async (req: any, res) => {
    try {
      const secret = speakeasy.generateSecret({
        name: `FlexSend (${req.actor.user_id})`
      });

      await db.query(
        'UPDATE app_users SET totp_secret=$1 WHERE user_id=$2',
        [secret.base32, req.actor.user_id]
      );

      const qrCode = await QRCode.toDataURL(secret.otpauth_url!);

      res.json({
        success: true,
        data: {
          secret:  secret.base32,
          qr_code: qrCode,
          message: 'Scan QR code with Google Authenticator'
        }
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

export default router;
