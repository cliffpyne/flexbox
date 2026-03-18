import { db }   from '../db';
import bcrypt   from 'bcrypt';

// ─── Store a refresh token ────────────────────────────────────────────────
export async function storeRefreshToken(params: {
  user_id:          string;
  token:            string;
  token_family:     string;
  device_id:        string;
  parent_token_id:  string;
  expires_at:       Date;
}) {
  const token_hash = await bcrypt.hash(params.token, 10);

  const { rows: [row] } = await db.query(
    `INSERT INTO refresh_tokens
       (user_id, token_hash, token_family, device_id, parent_token_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING token_id`,
    [params.user_id, token_hash, params.token_family,
     params.device_id, params.parent_token_id, params.expires_at]
  );

  return row.token_id;
}

// ─── Find and validate refresh token ─────────────────────────────────────
export async function findRefreshToken(
  user_id: string,
  token:   string
): Promise<any | null> {
  const { rows } = await db.query(
    `SELECT * FROM refresh_tokens
     WHERE user_id = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 20`,
    [user_id]
  );

  for (const row of rows) {
    const match = await bcrypt.compare(token, row.token_hash);
    if (match) return row;
  }

  return null;
}

// ─── Check if family is revoked ───────────────────────────────────────────
export async function isFamilyRevoked(token_family: string): Promise<boolean> {
  const { rows } = await db.query(
    'SELECT 1 FROM refresh_tokens WHERE token_family = $1 AND revoked_at IS NOT NULL',
    [token_family]
  );
  return rows.length > 0;
}

// ─── Revoke a specific token ──────────────────────────────────────────────
export async function revokeToken(token_id: string) {
  await db.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_id = $1',
    [token_id]
  );
}

// ─── Revoke entire token family (attack detected) ────────────────────────
export async function revokeFamilyTokens(token_family: string) {
  await db.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_family = $1',
    [token_family]
  );
}

// ─── Revoke all tokens for a user (logout all devices) ───────────────────
export async function revokeAllUserTokens(user_id: string) {
  await db.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [user_id]
  );
}

// ─── Revoke tokens for a specific device only ────────────────────────────
export async function revokeDeviceTokens(user_id: string, device_id: string) {
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
     WHERE user_id = $1 AND device_id = $2 AND revoked_at IS NULL`,
    [user_id, device_id]
  );
}

// ─── Get all active sessions for a user ──────────────────────────────────
export async function getActiveSessions(user_id: string) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (device_id)
       token_id, device_id, token_family,
       created_at, expires_at
     FROM refresh_tokens
     WHERE user_id = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()
     ORDER BY device_id, created_at DESC`,
    [user_id]
  );
  return rows;
}

// ─── Get token chain for forensic investigation ───────────────────────────
export async function getTokenChain(token_family: string) {
  const { rows } = await db.query(
    `SELECT token_id, parent_token_id, device_id,
            created_at, revoked_at, expires_at
     FROM refresh_tokens
     WHERE token_family = $1
     ORDER BY created_at ASC`,
    [token_family]
  );
  return rows;
}
