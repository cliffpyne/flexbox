import jwt          from 'jsonwebtoken';
import crypto        from 'crypto';
import { ROLE_PERMISSIONS } from '@flexbox/constants';
import { UserRole }         from '@flexbox/types';

const PRIVATE_KEY = Buffer
  .from(process.env.TOKEN_PRIVATE_KEY_BASE64 || '', 'base64')
  .toString('utf-8')
  .trim();

export const PUBLIC_KEY = Buffer
  .from(process.env.TOKEN_PUBLIC_KEY_BASE64 || '', 'base64')
  .toString('utf-8')
  .trim();

if (!PRIVATE_KEY || !PUBLIC_KEY) {
  throw new Error('JWT keys are not configured.');
}

export interface TokenPayload {
  user_id:      string;
  role:         UserRole;
  actor_type:   UserRole;
  office_id:    string | null;
  permissions:  string[];
  device_id:    string;
  token_family: string;
}

export interface RefreshPayload {
  user_id:          string;
  token_family:     string;
  device_id:        string;
  parent_token_id:  string;
}

export function generateTokens(user: {
  user_id:           string;
  role:              UserRole;
  office_id?:        string | null;
  device_id?:        string;
  token_family?:     string;
  parent_token_id?:  string;
}) {
  const permissions     = ROLE_PERMISSIONS[user.role] || [];
  const device_id       = user.device_id      || 'unknown';
  const token_family    = user.token_family   || crypto.randomUUID();
  const parent_token_id = user.parent_token_id || 'root';

  const accessToken = jwt.sign(
    { user_id: user.user_id, role: user.role, actor_type: user.role,
      office_id: user.office_id || null, permissions, device_id, token_family },
    PRIVATE_KEY,
    { algorithm: 'RS256', expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    { user_id: user.user_id, token_family, device_id, parent_token_id },
    PRIVATE_KEY,
    { algorithm: 'RS256', expiresIn: '30d' }
  );

  return { accessToken, refreshToken, token_family, device_id };
}

export function verifyToken(token: string): any {
  return jwt.verify(token, PUBLIC_KEY, { algorithms: ['RS256'] });
}
