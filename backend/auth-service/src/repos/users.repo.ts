import { db } from '../db';

// ─── Get user by phone ────────────────────────────────────────────────────
export async function getUserByPhone(phone: string) {
  const { rows: [user] } = await db.query(
    'SELECT * FROM app_users WHERE phone = $1',
    [phone]
  );
  return user || null;
}

// ─── Get user by username ─────────────────────────────────────────────────
export async function getUserByUsername(username: string) {
  const { rows: [user] } = await db.query(
    'SELECT * FROM app_users WHERE username = $1',
    [username]
  );
  return user || null;
}

// ─── Get user by ID ───────────────────────────────────────────────────────
export async function getUserById(user_id: string) {
  const { rows: [user] } = await db.query(
    'SELECT * FROM app_users WHERE user_id = $1',
    [user_id]
  );
  return user || null;
}

// ─── Create customer (self-registered via OTP) ────────────────────────────
export async function createCustomer(phone: string) {
  const { rows: [user] } = await db.query(
    `INSERT INTO app_users
       (phone, role, is_verified, is_active, must_change_password)
     VALUES ($1, 'CUSTOMER', true, true, false)
     RETURNING user_id, phone, role, is_active, office_id`,
    [phone]
  );
  return user;
}

// ─── Create staff account (created by admin) ─────────────────────────────
export async function createStaffUser(params: {
  phone:             string;
  full_name:         string;
  username:          string;
  password_hash:     string;
  role:              string;
  office_id?:        string;
  nida_number?:      string;
  created_by:        string;
  must_change_password: boolean;
}) {
  const { rows: [user] } = await db.query(
    `INSERT INTO app_users
       (phone, full_name, username, password_hash, role,
        office_id, nida_number, is_verified, is_active,
        must_change_password, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true,true,$8,$9)
     RETURNING user_id, phone, full_name, username, role, office_id`,
    [
      params.phone, params.full_name, params.username,
      params.password_hash, params.role, params.office_id || null,
      params.nida_number || null, params.must_change_password,
      params.created_by,
    ]
  );
  return user;
}

// ─── Update last login ────────────────────────────────────────────────────
export async function updateLastLogin(user_id: string) {
  await db.query(
    'UPDATE app_users SET last_login_at = NOW() WHERE user_id = $1',
    [user_id]
  );
}

// ─── Mark password changed ────────────────────────────────────────────────
export async function markPasswordChanged(user_id: string, password_hash: string) {
  await db.query(
    `UPDATE app_users
     SET password_hash = $1, must_change_password = false
     WHERE user_id = $2`,
    [password_hash, user_id]
  );
}

// ─── Update username ──────────────────────────────────────────────────────
export async function updateUsername(user_id: string, username: string) {
  await db.query(
    'UPDATE app_users SET username = $1 WHERE user_id = $2',
    [username, user_id]
  );
}

// ─── Deactivate user ──────────────────────────────────────────────────────
export async function deactivateUser(user_id: string) {
  await db.query(
    'UPDATE app_users SET is_active = false WHERE user_id = $1',
    [user_id]
  );
}

// ─── Save document ────────────────────────────────────────────────────────
export async function saveDocument(params: {
  user_id:     string;
  doc_type:    string;
  doc_number:  string;
  doc_url:     string;
  uploaded_by: string;
}) {
  await db.query(
    `INSERT INTO user_documents
       (user_id, doc_type, doc_number, doc_url, uploaded_by)
     VALUES ($1,$2,$3,$4,$5)`,
    [params.user_id, params.doc_type, params.doc_number,
     params.doc_url, params.uploaded_by]
  );
}
