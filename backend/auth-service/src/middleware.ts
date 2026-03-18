import { Request, Response, NextFunction } from 'express';
import { verifyToken } from './jwt';
import { redis }       from './redis';
import { Permission, UserRole } from '@flexbox/types';

// ─── Authenticate — validate JWT on every protected route ─────────────────
export async function authenticate(req: any, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ success: false, message: 'AUTH_001: Missing token' });
  }

  try {
    const payload = verifyToken(token);

    const flag = await redis.get(`session:active:${payload.user_id}`);

    if (flag === '0') {
      return res.status(401).json({
        success: false,
        message: 'AUTH_003: Session revoked'
      });
    }

    req.actor = payload;
    next();
  } catch {
    res.status(401).json({ success: false, message: 'AUTH_002: Token expired or invalid' });
  }
}

// ─── Require specific roles ────────────────────────────────────────────────
export function requireRole(...roles: UserRole[]) {
  return (req: any, res: Response, next: NextFunction) => {
    if (!roles.includes(req.actor?.role)) {
      return res.status(403).json({
        success: false,
        message: 'AUTH_008: Insufficient permissions'
      });
    }
    next();
  };
}

// ─── Require specific permission ──────────────────────────────────────────
export function requirePermission(permission: Permission) {
  return (req: any, res: Response, next: NextFunction) => {
    const permissions: string[] = req.actor?.permissions || [];
    if (!permissions.includes(permission) && !permissions.includes('*')) {
      return res.status(403).json({
        success: false,
        message: 'AUTH_008: Insufficient permissions'
      });
    }
    next();
  };
}

// ─── Require must_change_password = false ─────────────────────────────────
// Blocks access to all routes if user has not changed their first password yet
// Only allow: POST /auth/password/change
export function blockIfMustChangePassword(req: any, res: Response, next: NextFunction) {
  if (req.actor?.must_change_password) {
    return res.status(403).json({
      success: false,
      message: 'AUTH_009: You must change your password before continuing.',
      must_change_password: true,
    });
  }
  next();
}
