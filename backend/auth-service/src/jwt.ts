import jwt from 'jsonwebtoken';
import { ROLE_PERMISSIONS } from '@flexbox/constants';
import { UserRole } from '@flexbox/types';
import crypto from 'crypto';

// ─── Load RS256 keypair ────────────────────────────────────────────────────
// Private key: used ONLY in auth-service to SIGN tokens
// Public key:  shared with API and all services to VERIFY tokens

const PRIVATE_KEY = Buffer
  .from(process.env.TOKEN_PRIVATE_KEY_BASE64 || '', 'base64')
  .toString('utf-8')
  .trim();

const PUBLIC_KEY = Buffer
  .from(process.env.TOKEN_PUBLIC_KEY_BASE64 || '', 'base64')
  .toString('utf-8')
  .trim();

// Optional: minimal safety check (no noisy logs)
if (!PRIVATE_KEY || !PUBLIC_KEY) {
  throw new Error('JWT keys are not properly configured');
}

// ─── Token payloads ────────────────────────────────────────────────────────
export interface TokenPayload {
  user_id: string;
  role: UserRole;
  actor_type: UserRole;
  office_id: string | null;
  permissions: string[];
}

export interface RefreshPayload {
  user_id: string;
  token_family: string; // for rotation — detects refresh token reuse
}

// ─── Generate access + refresh token pair ─────────────────────────────────
export function generateTokens(user: {
  user_id: string;
  role: UserRole;
  office_id?: string | null;
}) {
  const permissions = ROLE_PERMISSIONS[user.role] || [];

  const accessPayload: TokenPayload = {
    user_id: user.user_id,
    role: user.role,
    actor_type: user.role,
    office_id: user.office_id || null,
    permissions,
  };

  // Access token: RS256, 15 minutes
  const accessToken = jwt.sign(accessPayload, PRIVATE_KEY, {
    algorithm: 'RS256',
    expiresIn: '15m',
  });

  // Refresh token: RS256, 30 days
  const family = crypto.randomUUID();

  const refreshToken = jwt.sign(
    { user_id: user.user_id, token_family: family } as RefreshPayload,
    PRIVATE_KEY,
    {
      algorithm: 'RS256',
      expiresIn: '30d',
    }
  );

  return { accessToken, refreshToken, family };
}

// ─── Verify any token ─────────────────────────────────────────────────────
export function verifyToken(token: string): any {
  return jwt.verify(token, PUBLIC_KEY, {
    algorithms: ['RS256'],
  });
}