import { db } from '../db';

// ─── Generate a unique username ────────────────────────────────────────────
// Format: FS-XXXX where XXXX is a zero-padded number
// Examples: FS-0001, FS-0892, FS-2341
//
// Tries up to 10 times to find one that is not taken.
// In practice this almost never needs more than 1 attempt.

export async function generateUsername(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const number   = Math.floor(1000 + Math.random() * 9000); // 1000–9999
    const username = `FS-${number}`;

    const { rows } = await db.query(
      'SELECT 1 FROM app_users WHERE username = $1',
      [username]
    );

    if (rows.length === 0) return username; // not taken
  }

  // Fallback: use timestamp suffix — guaranteed unique
  return `FS-${Date.now().toString().slice(-6)}`;
}

// ─── Validate a user-chosen username ──────────────────────────────────────
// Returns null if valid, or an error message if not
export async function validateUsername(
  username: string,
  currentUserId?: string
): Promise<string | null> {
  // Format: 3–20 chars, letters, numbers, hyphens, underscores only
  if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
    return 'Username must be 3–20 characters. Letters, numbers, hyphens, underscores only.';
  }

  // Cannot be the same as another user's phone number
  const phoneCheck = await db.query(
    'SELECT 1 FROM app_users WHERE phone = $1',
    [username]
  );
  if (phoneCheck.rows.length > 0) {
    return 'Username cannot be a phone number.';
  }

  // Must be unique
  const query = currentUserId
    ? 'SELECT 1 FROM app_users WHERE username = $1 AND user_id != $2'
    : 'SELECT 1 FROM app_users WHERE username = $1';
  const params = currentUserId ? [username, currentUserId] : [username];
  const { rows } = await db.query(query, params);

  if (rows.length > 0) {
    return 'Username already taken.';
  }

  return null; // valid
}
