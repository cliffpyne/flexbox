import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const PUBLIC_KEY = Buffer
  .from(process.env.TOKEN_PUBLIC_KEY_BASE64 || '', 'base64')
  .toString('utf-8')
  .trim();

export function authenticate(req: any, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ success: false, message: 'AUTH_001: Missing token' });
  try {
    req.actor = jwt.verify(token, PUBLIC_KEY, { algorithms: ['RS256'] });
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
  const isOwn = req.actor?.user_id === req.params.id;
  const isManager = ['OFFICE_MANAGER', 'OPS_ADMIN', 'SUPER_ADMIN'].includes(req.actor?.role);
  if (!isOwn && !isManager) {
    return res.status(403).json({ success: false, message: 'AUTH_003: Access denied' });
  }
  next();
}
