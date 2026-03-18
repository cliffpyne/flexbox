import { Response, NextFunction } from 'express';
import jwt  from 'jsonwebtoken';
import fs   from 'fs';
import path from 'path';
import { UserRole, Permission } from '@flexbox/types';

// RS256 public key — only used to VERIFY tokens
// Private key never leaves auth-service
const PUBLIC_KEY = Buffer
  .from(process.env.TOKEN_PUBLIC_KEY_BASE64 || '', 'base64')
  .toString('utf-8')
  .trim();
if (!PUBLIC_KEY) throw new Error('TOKEN_PUBLIC_KEY env variable is required');

// ─── Validate JWT on every protected route ─────────────────────────────────
export function authenticate(req: any, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ success: false, message: 'AUTH_001: Missing token' });
  }
  try {
    req.actor = jwt.verify(token, PUBLIC_KEY, { algorithms: ['RS256'] });
    next();
  } catch {
    res.status(401).json({ success: false, message: 'AUTH_002: Token expired or invalid' });
  }
}

// ─── Require specific roles ────────────────────────────────────────────────
export function requireRole(...roles: UserRole[]) {
  return (req: any, res: Response, next: NextFunction) => {
    if (!roles.includes(req.actor?.role)) {
      return res.status(403).json({ success: false, message: 'AUTH_008: Insufficient permissions' });
    }
    next();
  };
}

// ─── Require specific permission ──────────────────────────────────────────
export function requirePermission(permission: Permission) {
  return (req: any, res: Response, next: NextFunction) => {
    const permissions: string[] = req.actor?.permissions || [];
    if (!permissions.includes(permission) && !permissions.includes('*')) {
      return res.status(403).json({ success: false, message: 'AUTH_008: Insufficient permissions' });
    }
    next();
  };
}

// ─── Require office match — worker can only act on their own office ────────
export function requireSameOffice(paramName = 'id') {
  return (req: any, res: Response, next: NextFunction) => {
    const officeId = req.params[paramName];
    const actorOffice = req.actor?.office_id;

    // OPS_ADMIN and SUPER_ADMIN can access any office
    if ([UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN].includes(req.actor?.role)) {
      return next();
    }

    if (actorOffice !== officeId) {
      return res.status(403).json({
        success: false,
        message: 'AUTH_009: You can only access your own office',
      });
    }
    next();
  };
}
