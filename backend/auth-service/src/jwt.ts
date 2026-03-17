import jwt from 'jsonwebtoken';

import { ROLE_PERMISSIONS } from '@flexbox/constants';
import { UserRole }         from '@flexbox/types';
import crypto from 'crypto';



// ─── Load RS256 keypair ────────────────────────────────────────────────────
// Private key: used ONLY in auth-service to SIGN tokens
// Public key:  shared with API x and all services to VERIFY tokens
// NEVER share the private key outside this service

const PRIVATE_KEY = Buffer
  .from(process.env.TOKEN_PRIVATE_KEY_BASE64 || '', 'base64')
  .toString('utf-8')
  .trim();

const PUBLIC_KEY = Buffer
  .from(process.env.TOKEN_PUBLIC_KEY_BASE64 || '', 'base64')
  .toString('utf-8')
  .trim();
//clifford
try {
  crypto.createPrivateKey(PRIVATE_KEY);
  console.log("✅ Private key is valid");
} catch (err) {
  console.error("❌ Invalid private key:", err.message);
}

console.log('KEY_CHARS:', JSON.stringify(PRIVATE_KEY.substring(0, 50)));

console.log('KEY_LENGTH:', PRIVATE_KEY.length);
console.log('KEY_START:', PRIVATE_KEY.substring(0, 30));
console.log('HAS_NEWLINES:', PRIVATE_KEY.includes('\n'));


// ─── Token payloads ────────────────────────────────────────────────────────
export interface TokenPayload {
  user_id:     string;
  role:        UserRole;
  actor_type:  UserRole;
  office_id:   string | null;
  permissions: string[];
}

export interface RefreshPayload {
  user_id:      string;
  token_family: string; // for rotation — detects refresh token reuse
}
console.log('Signing with key type:', typeof PRIVATE_KEY, 'length:', PRIVATE_KEY.length, 'first char code:', PRIVATE_KEY.charCodeAt(0));
// ─── Generate access + refresh token pair ─────────────────────────────────
export function generateTokens(user: {
  user_id:   string;
  role:      UserRole;
  office_id?: string | null;
}) {
  const permissions = ROLE_PERMISSIONS[user.role] || [];

  const accessPayload: TokenPayload = {
    user_id:    user.user_id,
    role:       user.role,
    actor_type: user.role,
    office_id:  user.office_id || null,
    permissions,
  };

  // Access token: RS256, 15 minutes
  // Downstream services verify with PUBLIC KEY only — never need private key
  const accessToken = jwt.sign(accessPayload, PRIVATE_KEY, {
    algorithm: 'RS256',
    expiresIn: '15m',
  });

  // Refresh token: RS256, 30 days
  // token_family used for rotation detection
  const family = crypto.randomUUID();
  const refreshToken = jwt.sign(
    { user_id: user.user_id, token_family: family } as RefreshPayload,
    PRIVATE_KEY,
    { algorithm: 'RS256', expiresIn: '30d' }
  );

  return { accessToken, refreshToken, family };
}

// ─── Verify any token ─────────────────────────────────────────────────────
export function verifyToken(token: string): any {
  return jwt.verify(token, PUBLIC_KEY, { algorithms: ['RS256'] });
}
