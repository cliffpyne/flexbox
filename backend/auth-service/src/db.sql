-- ============================================================
-- AUTH SERVICE — COMPLETE DATABASE SCHEMA
-- Run this on your Supabase SQL editor
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── app_users ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_users (
  user_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  username             VARCHAR(20) UNIQUE,
  phone                VARCHAR(20) UNIQUE NOT NULL,
  full_name            VARCHAR(100),
  password_hash        TEXT,                        -- null for customers (OTP only)
  pin_hash             TEXT,                        -- for riders/office workers (PIN login)
  role                 VARCHAR(30) NOT NULL,
  status               VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  is_active            BOOLEAN     NOT NULL DEFAULT true,
  is_verified          BOOLEAN     NOT NULL DEFAULT false,
  must_change_password BOOLEAN     NOT NULL DEFAULT false,
  office_id            UUID,                        -- which office this user belongs to
  nida_number          VARCHAR(50),                 -- national ID
  totp_secret          TEXT,                        -- for OPS_ADMIN/SUPER_ADMIN 2FA
  created_by           UUID        REFERENCES app_users(user_id),
  last_login_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_users_phone    ON app_users(phone);
CREATE INDEX IF NOT EXISTS idx_users_username ON app_users(username);
CREATE INDEX IF NOT EXISTS idx_users_role     ON app_users(role);
CREATE INDEX IF NOT EXISTS idx_users_office   ON app_users(office_id);

-- ─── user_documents ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_documents (
  doc_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  doc_type     VARCHAR(30) NOT NULL,   -- NIDA, DRIVERS_LICENSE, PASSPORT, OTHER
  doc_number   VARCHAR(100) NOT NULL,  -- actual ID number
  doc_url      TEXT        NOT NULL,   -- URL to uploaded file
  verified     BOOLEAN     NOT NULL DEFAULT false,
  uploaded_by  UUID        REFERENCES app_users(user_id),
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_user ON user_documents(user_id);

-- ─── refresh_tokens ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  token_hash   TEXT        NOT NULL,      -- bcrypt hash of the raw token
  token_family UUID        NOT NULL,      -- for reuse attack detection
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,               -- null = still valid
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tokens_user   ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_tokens_family ON refresh_tokens(token_family);
CREATE INDEX IF NOT EXISTS idx_tokens_active
  ON refresh_tokens(user_id)
  WHERE revoked_at IS NULL;

-- ─── Seed SUPER_ADMIN ─────────────────────────────────────────────────────
-- Run this separately after generating a bcrypt hash of your admin password
-- bcrypt hash of "ChangeMe@123" — CHANGE THIS PASSWORD ON FIRST LOGIN
INSERT INTO app_users (
  username, phone, full_name, password_hash,
  role, is_active, is_verified, must_change_password
) VALUES (
  'FS-0001',
  '+255000000000',
  'Super Admin',
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBpj2deGuP5a8i',
  'SUPER_ADMIN', true, true, true  -- must change password on first login
) ON CONFLICT DO NOTHING;
