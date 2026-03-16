import bcrypt  from 'bcrypt';
import crypto  from 'crypto';

const SALT_ROUNDS = 12;

// ─── Generate a random first-time password ────────────────────────────────
// 10 characters: mix of upper, lower, numbers, symbols
// Easy enough to type from SMS, strong enough to be secure
// User MUST change this on first login

export function generatePassword(): string {
  const upper   = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, O (confusing)
  const lower   = 'abcdefghjkmnpqrstuvwxyz';  // no i, l, o
  const digits  = '23456789';                  // no 0, 1 (confusing)
  const symbols = '@#$%';

  const pick = (chars: string) =>
    chars[crypto.randomInt(chars.length)];

  // Guarantee at least one of each type
  const required = [
    pick(upper),
    pick(upper),
    pick(lower),
    pick(lower),
    pick(digits),
    pick(digits),
    pick(symbols),
  ];

  // Fill remaining slots
  const all = upper + lower + digits + symbols;
  while (required.length < 10) {
    required.push(pick(all));
  }

  // Shuffle so required chars are not always in the same positions
  return required
    .map(c => ({ c, sort: crypto.randomInt(1000) }))
    .sort((a, b) => a.sort - b.sort)
    .map(x => x.c)
    .join('');
}

// ─── Hash a password ──────────────────────────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

// ─── Verify a password ────────────────────────────────────────────────────
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ─── Validate password strength ───────────────────────────────────────────
// Returns null if valid, or an error message
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter.';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must contain at least one lowercase letter.';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least one number.';
  }
  return null;
}
