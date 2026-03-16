import { db }   from '../db';
import bcrypt    from 'bcrypt';
import crypto    from 'crypto';

// ─── Store a refresh token ────────────────────────────────────────────────
export async function storeRefreshToken(params: {
  user_id:      string;
  token:        string;  // raw token string
  token_family: string;
  expires_at:   Date;
}) {
  const token_hash = await bcrypt.hash(params.token, 10);

  await db.query(
    `INSERT INTO refresh_tokens
       (user_id, token_hash, token_family, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [params.user_id, token_hash, params.token_family, params.expires_at]
  );
}

// ─── Find and validate refresh token ─────────────────────────────────────
// Returns the DB row if valid, null if not found/expired/revoked
export async function findRefreshToken(
  user_id: string,
  token: string
): Promise<any | null> {
  const { rows } = await db.query(
    `SELECT * FROM refresh_tokens
     WHERE user_id = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()
     ORDER BY created_at DESC`,
    [user_id]
  );

  // Check each stored hash (user may have multiple active sessions)
  for (const row of rows) {
    const match = await bcrypt.compare(token, row.token_hash);
    if (match) return row;
  }

  return null;
}

// ─── Check if token family has been revoked (reuse detection) ────────────
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

// ─── Revoke ALL tokens for a user (logout from all devices) ──────────────
export async function revokeAllUserTokens(user_id: string) {
  await db.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [user_id]
  );
}

// ─── Revoke entire token family (reuse attack detected) ──────────────────
export async function revokeFamilyTokens(token_family: string) {
  await db.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_family = $1',
    [token_family]
  );
}
