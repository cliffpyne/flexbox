import jwt from 'jsonwebtoken';
import { ROLE_PERMISSIONS } from '@flexbox/constants';
import { UserRole } from '@flexbox/types';
import 'dotenv/config';

const SECRET = process.env.JWT_SECRET || 'REPLACE_THIS_WITH_REAL_SECRET'; // ← REPLACE IN .env

export function generateTokens(user: {
  user_id:   string;
  role:      UserRole;
  office_id?: string;
}) {
  const permissions = ROLE_PERMISSIONS[user.role] || [];

  const payload = {
    user_id:     user.user_id,
    actor_type:  user.role,
    role:        user.role,
    office_id:   user.office_id || null,
    permissions,
  };

  const accessToken = jwt.sign(payload, SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ user_id: user.user_id }, SECRET, { expiresIn: '30d' });

  return { accessToken, refreshToken };
}

export function verifyToken(token: string) {
  return jwt.verify(token, SECRET) as any;
}
