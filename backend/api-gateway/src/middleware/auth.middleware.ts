import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { redis } from '../redis';

// ── JWT Authentication ────────────────────────────────────────────────────────
export async function authenticate(req: any, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: { code: 'TOKEN_MISSING', message: 'Authentication required' }
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const secret = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET || '';
    const payload: any = jwt.verify(token, secret);

    // Check session not deactivated — Redis flag avoids DB hit on every request
    try {
      const isActive = await redis.get(`session:active:${payload.user_id}`);
      if (isActive === '0') {
        return res.status(403).json({
          success: false,
          error: { code: 'ACCOUNT_DEACTIVATED', message: 'Account is no longer active' }
        });
      }
    } catch {
      // Redis unavailable — allow request, degrade gracefully
      console.warn('[gateway] Redis unavailable for session check — allowing request');
    }

    // Attach actor context to request
    req.userId      = payload.user_id;
    req.userRole    = payload.role;
    req.actorType   = payload.actor_type;
    req.officeId    = payload.office_id ?? null;
    req.permissions = payload.permissions ?? [];

    // Forward actor context as headers to downstream services
    // Downstream services trust these — they never re-verify the JWT
    req.headers['x-user-id']     = payload.user_id;
    req.headers['x-user-role']   = payload.role;
    req.headers['x-actor-type']  = payload.actor_type ?? '';
    req.headers['x-office-id']   = payload.office_id ?? '';
    req.headers['x-permissions'] = JSON.stringify(payload.permissions ?? []);

    // Remove raw Authorization header so downstream never sees the JWT
    delete req.headers['authorization'];

    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: { code: 'TOKEN_EXPIRED', message: 'Token expired — please refresh' }
      });
    }
    return res.status(401).json({
      success: false,
      error: { code: 'TOKEN_INVALID', message: 'Invalid token' }
    });
  }
}

// ── Permission Check ──────────────────────────────────────────────────────────
export function requirePermission(permission: string) {
  return (req: any, res: Response, next: NextFunction) => {
    if (!req.permissions?.includes(permission)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: `This action requires the ${permission} permission`
        }
      });
    }
    next();
  };
}

// ── Role Check ────────────────────────────────────────────────────────────────
export function requireRole(...roles: string[]) {
  return (req: any, res: Response, next: NextFunction) => {
    if (!roles.includes(req.userRole)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_ROLE',
          message: `This action requires one of: ${roles.join(', ')}`
        }
      });
    }
    next();
  };
}

// ── Device API Key Auth — GPS boxes only ──────────────────────────────────────
export function authenticateDevice(req: any, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-device-api-key'];
  if (!apiKey || apiKey !== process.env.GPS_DEVICE_API_KEY) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_DEVICE_KEY', message: 'Invalid device API key' }
    });
  }
  next();
}