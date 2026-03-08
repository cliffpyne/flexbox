import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
export function authenticate(req: any, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ success: false, message: 'AUTH_001: Missing token' });
  try { req.actor = jwt.verify(token, process.env.JWT_SECRET || ''); next(); }
  catch { res.status(401).json({ success: false, message: 'AUTH_002: Invalid token' }); }
}