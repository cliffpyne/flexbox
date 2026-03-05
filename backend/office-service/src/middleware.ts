import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole, Permission } from '@flexbox/types';

export function authenticate(req: any, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ success: false, message: 'AUTH_001: Missing token' });
  }
  try {
    req.actor = jwt.verify(token, process.env.JWT_SECRET || '');
    next();
  } catch {
    res.status(401).json({ success: false, message: 'AUTH_002: Token expired or invalid' });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: any, res: Response, next: NextFunction) => {
    if (!roles.includes(req.actor?.role)) {
      return res.status(403).json({ success: false, message: 'AUTH_008: Insufficient permissions' });
    }
    next();
  };
}

export function requirePermission(permission: Permission) {
  return (req: any, res: Response, next: NextFunction) => {
    const permissions: string[] = req.actor?.permissions || [];
    if (!permissions.includes(permission)) {
      return res.status(403).json({ success: false, message: 'AUTH_008: Insufficient permissions' });
    }
    next();
  };
}