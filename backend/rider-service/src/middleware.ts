import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export function authenticate(req: any, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ success: false, message: 'AUTH_001: Missing token' });
  try {
    req.actor = jwt.verify(token, process.env.JWT_SECRET || '');
    next();
  } catch {
    res.status(401).json({ success: false, message: 'AUTH_002: Invalid token' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: any, res: Response, next: NextFunction) => {
    if (!req.actor) return res.status(401).json({ success: false, message: 'AUTH_001: Not authenticated' });
    if (!roles.includes(req.actor.role)) {
      return res.status(403).json({ success: false, message: 'AUTH_003: Insufficient permissions' });
    }
    next();
  };
}

export function requireOwnOrManager(req: any, res: Response, next: NextFunction) {
  const { actor } = req;
  const { id } = req.params;
  if (!actor) return res.status(401).json({ success: false, message: 'AUTH_001: Not authenticated' });
  const isOwn = actor.user_id === id;
  const isManager = ['OFFICE_MANAGER', 'OPS_ADMIN'].includes(actor.role);
  if (!isOwn && !isManager) {
    return res.status(403).json({ success: false, message: 'AUTH_003: Cannot access another rider\'s data' });
  }
  next();
}