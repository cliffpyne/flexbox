-- ================================================================
-- FLEXSEND — DATABASE MIGRATION
-- Run once on Supabase in this exact order
-- ================================================================

-- Enable required extensions first
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- ================================================================
-- TABLE 1 — offices
-- Everything else references this table
-- ================================================================
CREATE TABLE IF NOT EXISTS offices (
  office_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  office_code          VARCHAR(20) UNIQUE NOT NULL,       -- e.g. DSM-HUB-01
  name                 VARCHAR(100) NOT NULL,
  region               VARCHAR(100) NOT NULL,
  address              TEXT NOT NULL,
  gps_lat              DECIMAL(10,8) NOT NULL,
  gps_lng              DECIMAL(11,8) NOT NULL,
  geofence_radius_meters INTEGER DEFAULT 100,
  geofence_polygon     GEOGRAPHY(POLYGON, 4326),          -- PostGIS precise boundary
  office_type          VARCHAR(20) DEFAULT 'BRANCH'
                         CHECK (office_type IN ('HUB','BRANCH','MINI')),
  status               VARCHAR(20) DEFAULT 'SETUP'
                         CHECK (status IN ('SETUP','ACTIVE','SUSPENDED','CLOSING','CLOSED')),
  capabilities         JSONB DEFAULT '{}',               -- all capability flags
  sla_config           JSONB DEFAULT '{}',               -- SLA times per level
  pricing_overrides    JSONB DEFAULT '{}',               -- local price modifications
  operating_hours      JSONB DEFAULT '{}',               -- per-day schedule
  manager_id           UUID,                             -- FK added after users table
  config_version       INTEGER DEFAULT 1,
  config_updated_at    TIMESTAMPTZ DEFAULT NOW(),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_offices_region   ON offices(region);
CREATE INDEX idx_offices_status   ON offices(status);
CREATE INDEX idx_offices_geo      ON offices USING GIST(geofence_polygon);

-- ================================================================
-- TABLE 2 — intercity_routes
-- Links origin and destination offices
-- ================================================================
CREATE TABLE IF NOT EXISTS intercity_routes (
  route_id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  origin_office_id     UUID NOT NULL REFERENCES offices(office_id),
  dest_office_id       UUID NOT NULL REFERENCES offices(office_id),
  route_code           VARCHAR(50) NOT NULL,             -- e.g. DSM-MWZ-001
  transport_type       VARCHAR(50) DEFAULT 'BUS'
                         CHECK (transport_type IN ('BUS','TRAIN','FLIGHT','TRUCK')),
  departure_schedules  JSONB DEFAULT '[]',               -- array of departure times
  estimated_hours      INTEGER NOT NULL,                 -- transit time in hours
  price_per_kg         DECIMAL(10,2) DEFAULT 0,
  is_active            BOOLEAN DEFAULT true,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(origin_office_id, dest_office_id, route_code)
);

CREATE INDEX idx_intercity_origin ON intercity_routes(origin_office_id);
CREATE INDEX idx_intercity_dest   ON intercity_routes(dest_office_id);

-- ================================================================
-- TABLE 3 — users
-- Base table for ALL actor types
-- Only relevant auth column populated per role
-- ================================================================
CREATE TABLE IF NOT EXISTS app_users (
  user_id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone                VARCHAR(20) UNIQUE NOT NULL,
  full_name            VARCHAR(100),
  email                VARCHAR(100),
  role                 VARCHAR(30) NOT NULL
                         CHECK (role IN (
                           'CUSTOMER','AGENT','RIDER',
                           'OFFICE_WORKER','OFFICE_MANAGER','BRANCH_MANAGER',
                           'SUPPORT_AGENT','PRICING_MANAGER','OPS_ADMIN','SUPER_ADMIN'
                         )),
  -- Auth fields — only relevant one populated per role
  pin_hash             VARCHAR(200),                     -- RIDER, OFFICE_WORKER
  password_hash        VARCHAR(200),                     -- MANAGER, ADMIN roles
  totp_secret          VARCHAR(200),                     -- OPS_ADMIN, SUPER_ADMIN
  -- Profile
  photo_url            TEXT,
  fcm_token            TEXT,                             -- Firebase push token
  is_active            BOOLEAN DEFAULT true,
  is_verified          BOOLEAN DEFAULT false,
  -- Fraud
  fraud_score          INTEGER DEFAULT 0,
  measurement_first    BOOLEAN DEFAULT false,            -- switched on after 3 mismatches
  -- Meta
  last_login_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_phone  ON users(phone);
CREATE INDEX idx_users_role   ON users(role);



-- ================================================================
-- TABLE 4 — agents
-- Extends users for agent-specific data
-- ================================================================
CREATE TABLE IF NOT EXISTS agents (
  agent_id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id              UUID UNIQUE NOT NULL REFERENCES app_users(user_id),
  office_id            UUID NOT NULL REFERENCES offices(office_id),
  territory_name       VARCHAR(100),
  territory_polygon    GEOGRAPHY(POLYGON, 4326),          -- PostGIS coverage zone
  commission_rate      DECIMAL(5,4) DEFAULT 0.05,         -- 5% default
  is_approved          BOOLEAN DEFAULT false,
  approved_by          UUID REFERENCES app_users(user_id),
  approved_at          TIMESTAMPTZ,
  total_bookings       INTEGER DEFAULT 0,
  total_commission     DECIMAL(12,2) DEFAULT 0,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agents_office   ON agents(office_id);
CREATE INDEX idx_agents_territory ON agents USING GIST(territory_polygon);

-- ================================================================
-- TABLE 5 — riders
-- Extends users for rider-specific data
-- ================================================================
CREATE TABLE IF NOT EXISTS riders (
  rider_id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id              UUID UNIQUE NOT NULL REFERENCES app_users(user_id),
  assigned_office_id   UUID NOT NULL REFERENCES offices(office_id),
  rider_type           VARCHAR(20) DEFAULT 'BOTH'
                         CHECK (rider_type IN ('PICKUP','DELIVERY','INTERCITY','BOTH')),
  vehicle_type         VARCHAR(30) DEFAULT 'MOTORCYCLE'
                         CHECK (vehicle_type IN ('MOTORCYCLE','BICYCLE','CAR','VAN')),
  plate_number         VARCHAR(20),
  is_online            BOOLEAN DEFAULT false,
  is_verified          BOOLEAN DEFAULT false,
  current_lat          DECIMAL(10,8),
  current_lng          DECIMAL(11,8),
  last_seen_at         TIMESTAMPTZ,
  rating               DECIMAL(3,2) DEFAULT 5.00,
  total_earnings       DECIMAL(12,2) DEFAULT 0,
  total_jobs           INTEGER DEFAULT 0,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_riders_office   ON riders(assigned_office_id);
CREATE INDEX idx_riders_online   ON riders(is_online);

-- ================================================================
-- TABLE 6 — boxes
-- GPS box inventory
-- ================================================================
CREATE TABLE IF NOT EXISTS boxes (
  box_id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  box_serial           VARCHAR(30) UNIQUE NOT NULL,       -- e.g. SND-BOX-0042
  gps_device_id        VARCHAR(100),                      -- hardware IMEI
  size_class           VARCHAR(5) NOT NULL
                         CHECK (size_class IN ('S','M','L','XL')),
  home_office_id       UUID NOT NULL REFERENCES offices(office_id),
  current_office_id    UUID REFERENCES offices(office_id),
  status               VARCHAR(20) DEFAULT 'AVAILABLE'
                         CHECK (status IN (
                           'AVAILABLE','LOADED','IN_TRANSIT','ARRIVED',
                           'DAMAGED','UNDER_REPAIR','RETIRED','MISSING'
                         )),
  condition_flags      JSONB DEFAULT '{"is_damaged":false,"is_tampered":false,"needs_repair":false,"is_clean":true}',
  last_seen_lat        DECIMAL(10,8),
  last_seen_lng        DECIMAL(11,8),
  last_seen_at         TIMESTAMPTZ,
  last_seen_office_id  UUID REFERENCES offices(office_id),
  battery_pct          INTEGER,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_boxes_status       ON boxes(status);
CREATE INDEX idx_boxes_home_office  ON boxes(home_office_id);
CREATE INDEX idx_boxes_current      ON boxes(current_office_id);

-- ================================================================
-- TABLE 7 — parcels
-- NO STATUS COLUMN — status derived from parcel_events
-- ================================================================
CREATE TABLE IF NOT EXISTS parcels (
  parcel_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_reference    VARCHAR(20) UNIQUE NOT NULL,       -- e.g. TZ-00441
  sender_id            UUID NOT NULL REFERENCES app_users(user_id),
  receiver_phone       VARCHAR(20) NOT NULL,
  receiver_id          UUID REFERENCES app_users(user_id),    -- filled when receiver claims
  origin_office_id     UUID REFERENCES offices(office_id),
  dest_office_id       UUID REFERENCES offices(office_id),
  route_code           VARCHAR(30) NOT NULL,              -- e.g. A1-B1-C1-D1
  universe             VARCHAR(20) NOT NULL
                         CHECK (universe IN ('UPCOUNTRY','IN_REGION')),
  item_category        VARCHAR(30) DEFAULT 'OTHER'
                         CHECK (item_category IN (
                           'DOCUMENTS','ELECTRONICS','CLOTHING',
                           'FOOD','FRAGILE','MACHINERY','OTHER'
                         )),
  description          TEXT,
  -- Declared dims (at booking)
  declared_weight_kg   DECIMAL(8,3),
  declared_length_cm   DECIMAL(8,2),
  declared_width_cm    DECIMAL(8,2),
  declared_height_cm   DECIMAL(8,2),
  declared_value       DECIMAL(12,2),
  -- Confirmed dims (at office)
  confirmed_weight_kg  DECIMAL(8,3),
  confirmed_length_cm  DECIMAL(8,2),
  confirmed_width_cm   DECIMAL(8,2),
  confirmed_height_cm  DECIMAL(8,2),
  -- Pricing
  estimated_price      DECIMAL(12,2) NOT NULL,
  confirmed_price      DECIMAL(12,2),
  deposit_amount       DECIMAL(12,2),
  -- Addresses
  pickup_address       TEXT,
  pickup_lat           DECIMAL(10,8),
  pickup_lng           DECIMAL(11,8),
  delivery_address     TEXT,
  delivery_lat         DECIMAL(10,8),
  delivery_lng         DECIMAL(11,8),
  -- Return
  parent_booking_id    UUID REFERENCES parcels(parcel_id), -- for return bookings
  -- Meta
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_parcels_sender       ON parcels(sender_id);
CREATE INDEX idx_parcels_receiver     ON parcels(receiver_phone);
CREATE INDEX idx_parcels_origin       ON parcels(origin_office_id);
CREATE INDEX idx_parcels_dest         ON parcels(dest_office_id);
CREATE INDEX idx_parcels_booking_ref  ON parcels(booking_reference);
CREATE INDEX idx_parcels_route        ON parcels(route_code);

-- ================================================================
-- TABLE 8 — parcel_events
-- APPEND ONLY — never UPDATE or DELETE
-- Auto-incrementing sequence_number per parcel via trigger
-- ================================================================
CREATE TABLE IF NOT EXISTS parcel_events (
  event_id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parcel_id            UUID NOT NULL REFERENCES parcels(parcel_id),
  event_type           VARCHAR(100) NOT NULL,
  event_version        INTEGER DEFAULT 1,
  actor_type           VARCHAR(30) NOT NULL
                         CHECK (actor_type IN (
                           'CUSTOMER','AGENT','RIDER',
                           'OFFICE_WORKER','SYSTEM','ML'
                         )),
  actor_id             UUID NOT NULL,
  office_id            UUID REFERENCES offices(office_id),
  payload              JSONB DEFAULT '{}',
  gps_lat              DECIMAL(10,8),
  gps_lng              DECIMAL(11,8),
  occurred_at          TIMESTAMPTZ NOT NULL,              -- device time — when it happened
  recorded_at          TIMESTAMPTZ DEFAULT NOW(),         -- server time — when received
  sequence_number      BIGINT NOT NULL                    -- set by trigger below
);

-- Sequence trigger — auto-increments per parcel
CREATE SEQUENCE IF NOT EXISTS parcel_event_seq;

CREATE OR REPLACE FUNCTION set_parcel_event_sequence()
RETURNS TRIGGER AS $$
BEGIN
  SELECT COALESCE(MAX(sequence_number), 0) + 1
    INTO NEW.sequence_number
    FROM parcel_events
   WHERE parcel_id = NEW.parcel_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_parcel_event_sequence
  BEFORE INSERT ON parcel_events
  FOR EACH ROW EXECUTE FUNCTION set_parcel_event_sequence();

-- Prevent UPDATE and DELETE — append only
CREATE OR REPLACE RULE parcel_events_no_update AS
  ON UPDATE TO parcel_events DO INSTEAD NOTHING;

CREATE OR REPLACE RULE parcel_events_no_delete AS
  ON DELETE TO parcel_events DO INSTEAD NOTHING;

-- Critical indexes
CREATE INDEX idx_parcel_events_parcel      ON parcel_events(parcel_id);
CREATE INDEX idx_parcel_events_sequence    ON parcel_events(parcel_id, sequence_number);
CREATE INDEX idx_parcel_events_type        ON parcel_events(parcel_id, event_type);
CREATE INDEX idx_parcel_events_recorded    ON parcel_events(recorded_at);
CREATE INDEX idx_parcel_events_actor       ON parcel_events(actor_id);

-- ================================================================
-- TABLE 9 — custody_tokens
-- QR token lifecycle state machine
-- PENDING → ACTIVE → CONSUMED or DISCARDED
-- ================================================================
CREATE TABLE IF NOT EXISTS custody_tokens (
  token_id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parcel_id            UUID NOT NULL REFERENCES parcels(parcel_id),
  level                VARCHAR(5) NOT NULL
                         CHECK (level IN ('L1','L2','L3','L4','L5','L6')),
  token_type           VARCHAR(20) NOT NULL
                         CHECK (token_type IN (
                           'PICKUP','DELIVERY','BOX_SEAL','BOX_RECEIPT','LAST_MILE'
                         )),
  expected_actor_role  VARCHAR(30) NOT NULL,
  expected_office_id   UUID REFERENCES offices(office_id),
  state                VARCHAR(20) DEFAULT 'PENDING'
                         CHECK (state IN ('PENDING','ACTIVE','CONSUMED','DISCARDED','EXPIRED')),
  jwt_payload          TEXT NOT NULL,                     -- signed JWT string
  qr_data              TEXT NOT NULL,                     -- data encoded in QR code
  expires_at           TIMESTAMPTZ NOT NULL,
  consumed_at          TIMESTAMPTZ,
  consumed_by          UUID REFERENCES app_users(user_id),
  discarded_at         TIMESTAMPTZ,
  discard_reason       VARCHAR(100),
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tokens_parcel     ON custody_tokens(parcel_id);
CREATE INDEX idx_tokens_state      ON custody_tokens(state);
CREATE INDEX idx_tokens_expires    ON custody_tokens(expires_at);

-- ================================================================
-- TABLE 10 — box_parcel_assignments
-- Links parcels to boxes per trip
-- ================================================================
CREATE TABLE IF NOT EXISTS box_parcel_assignments (
  assignment_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  box_id               UUID NOT NULL REFERENCES boxes(box_id),
  parcel_id            UUID NOT NULL REFERENCES parcels(parcel_id),
  assigned_by          UUID NOT NULL REFERENCES app_users(user_id),
  packing_position     JSONB DEFAULT '{}',                -- x,y,z position inside box
  assigned_at          TIMESTAMPTZ DEFAULT NOW(),
  removed_at           TIMESTAMPTZ,
  UNIQUE(box_id, parcel_id)
);

CREATE INDEX idx_box_assignments_box    ON box_parcel_assignments(box_id);
CREATE INDEX idx_box_assignments_parcel ON box_parcel_assignments(parcel_id);

-- ================================================================
-- TABLE 11 — packing_instructions
-- Algorithm output stored as JSONB with 3D visual layout data
-- ================================================================
CREATE TABLE IF NOT EXISTS packing_instructions (
  instruction_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  box_id               UUID NOT NULL REFERENCES boxes(box_id),
  trip_id              VARCHAR(50) NOT NULL,               -- groups instructions per dispatch
  instructions         JSONB NOT NULL,                    -- per-parcel placement data
  visual_layout        JSONB DEFAULT '{}',                -- 3D diagram data for dashboard
  estimated_fill_pct   DECIMAL(5,2),
  total_parcels        INTEGER DEFAULT 0,
  total_weight_kg      DECIMAL(10,3),
  generated_at         TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at         TIMESTAMPTZ,
  confirmed_by         UUID REFERENCES app_users(user_id),
  override_reason      VARCHAR(200)                        -- if worker deviated from plan
);

CREATE INDEX idx_packing_box  ON packing_instructions(box_id);
CREATE INDEX idx_packing_trip ON packing_instructions(trip_id);

-- ================================================================
-- TABLE 12 — pricing_config
-- Versioned. Requires approval before taking effect.
-- ================================================================
CREATE TABLE IF NOT EXISTS pricing_config (
  config_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  office_id            UUID REFERENCES offices(office_id), -- NULL = global config
  version              INTEGER NOT NULL,
  status               VARCHAR(20) DEFAULT 'PENDING'
                         CHECK (status IN ('PENDING','ACTIVE','SUPERSEDED','REJECTED')),
  config               JSONB NOT NULL,                    -- full pricing rules
  created_by           UUID NOT NULL REFERENCES app_users(user_id),
  approved_by          UUID REFERENCES app_users(user_id),
  approved_at          TIMESTAMPTZ,
  effective_from       TIMESTAMPTZ,
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pricing_office  ON pricing_config(office_id);
CREATE INDEX idx_pricing_status  ON pricing_config(status);

-- ================================================================
-- TABLE 13 — payment_records
-- idempotency_key UNIQUE — prevents double-charging
-- ================================================================
CREATE TABLE IF NOT EXISTS payment_records (
  payment_id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parcel_id            UUID NOT NULL REFERENCES parcels(parcel_id),
  user_id              UUID NOT NULL REFERENCES app_users(user_id),
  amount               DECIMAL(12,2) NOT NULL,
  method               VARCHAR(20) NOT NULL
                         CHECK (method IN ('MPESA','AIRTEL_MONEY','CASH','CARD')),
  status               VARCHAR(20) DEFAULT 'PENDING'
                         CHECK (status IN ('PENDING','CONFIRMED','FAILED','REFUNDED')),
  idempotency_key      VARCHAR(100) UNIQUE NOT NULL,       -- prevents double-charging
  provider_reference   VARCHAR(100),                      -- mobile money ref
  provider_response    JSONB DEFAULT '{}',
  payment_type         VARCHAR(20) DEFAULT 'DEPOSIT'
                         CHECK (payment_type IN ('DEPOSIT','BALANCE','REFUND','COMMISSION')),
  initiated_at         TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at         TIMESTAMPTZ,
  failed_at            TIMESTAMPTZ,
  failure_reason       TEXT
);

CREATE INDEX idx_payments_parcel      ON payment_records(parcel_id);
CREATE INDEX idx_payments_user        ON payment_records(user_id);
CREATE INDEX idx_payments_status      ON payment_records(status);
CREATE INDEX idx_payments_idempotency ON payment_records(idempotency_key);

-- ================================================================
-- TABLE 14 — notification_log
-- Every notification sent recorded here
-- ================================================================
CREATE TABLE IF NOT EXISTS notification_log (
  notification_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id              UUID NOT NULL REFERENCES app_users(user_id),
  parcel_id            UUID REFERENCES parcels(parcel_id),
  channel              VARCHAR(20) NOT NULL
                         CHECK (channel IN ('SMS','PUSH','WHATSAPP')),
  template_key         VARCHAR(100) NOT NULL,
  title                VARCHAR(200),
  body                 TEXT NOT NULL,
  data                 JSONB DEFAULT '{}',
  status               VARCHAR(20) DEFAULT 'PENDING'
                         CHECK (status IN ('PENDING','SENT','FAILED','DELIVERED')),
  retry_count          INTEGER DEFAULT 0,
  sent_at              TIMESTAMPTZ,
  delivered_at         TIMESTAMPTZ,
  failure_reason       TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notif_user   ON notification_log(user_id);
CREATE INDEX idx_notif_parcel ON notification_log(parcel_id);
CREATE INDEX idx_notif_status ON notification_log(status);

-- ================================================================
-- TABLE 15 — support_tickets
-- internal_notes as JSONB array, evidence_urls as text array
-- ================================================================
CREATE TABLE IF NOT EXISTS support_tickets (
  ticket_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parcel_id            UUID NOT NULL REFERENCES parcels(parcel_id),
  raised_by            UUID NOT NULL REFERENCES app_users(user_id),
  assigned_to          UUID REFERENCES app_users(user_id),
  ticket_type          VARCHAR(50) NOT NULL
                         CHECK (ticket_type IN (
                           'MEASUREMENT_DISPUTE','DELIVERY_FAILURE',
                           'PAYMENT_DISPUTE','LOST_PARCEL',
                           'FRAUD_FLAG','RETURN_REQUEST','OTHER'
                         )),
  status               VARCHAR(20) DEFAULT 'OPEN'
                         CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','ESCALATED','CLOSED')),
  priority             VARCHAR(10) DEFAULT 'NORMAL'
                         CHECK (priority IN ('LOW','NORMAL','HIGH','CRITICAL')),
  description          TEXT NOT NULL,
  internal_notes       JSONB DEFAULT '[]',                -- array of note objects
  evidence_urls        TEXT[],                            -- array of photo URLs
  resolution           TEXT,
  resolved_by          UUID REFERENCES app_users(user_id),
  resolved_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tickets_parcel   ON support_tickets(parcel_id);
CREATE INDEX idx_tickets_status   ON support_tickets(status);
CREATE INDEX idx_tickets_assigned ON support_tickets(assigned_to);

-- ================================================================
-- TABLE 16 — otp_requests
-- Audit trail only — fast validation done in Redis
-- ================================================================
CREATE TABLE IF NOT EXISTS otp_requests (
  otp_id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone                VARCHAR(20) NOT NULL,
  otp_hash             VARCHAR(200) NOT NULL,             -- bcrypt hashed OTP
  purpose              VARCHAR(30) DEFAULT 'LOGIN'
                         CHECK (purpose IN ('LOGIN','REGISTER','RESET')),
  is_used              BOOLEAN DEFAULT false,
  used_at              TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ NOT NULL,
  attempt_count        INTEGER DEFAULT 0,
  ip_address           VARCHAR(50),
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_otp_phone   ON otp_requests(phone);
CREATE INDEX idx_otp_expires ON otp_requests(expires_at);

-- ================================================================
-- TABLE 17 — audit_log
-- Append-only like parcel_events
-- Every admin and ops action recorded here — immutable
-- ================================================================
CREATE TABLE IF NOT EXISTS audit_log (
  audit_id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id             UUID NOT NULL REFERENCES app_users(user_id),
  actor_role           VARCHAR(30) NOT NULL,
  action               VARCHAR(100) NOT NULL,             -- e.g. OFFICE_CONFIG_UPDATED
  entity_type          VARCHAR(50),                       -- e.g. offices, users, parcels
  entity_id            UUID,
  before_state         JSONB,                             -- state before change
  after_state          JSONB,                             -- state after change
  ip_address           VARCHAR(50),
  user_agent           TEXT,
  occurred_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Prevent UPDATE and DELETE — append only
CREATE OR REPLACE RULE audit_log_no_update AS
  ON UPDATE TO audit_log DO INSTEAD NOTHING;

CREATE OR REPLACE RULE audit_log_no_delete AS
  ON DELETE TO audit_log DO INSTEAD NOTHING;

CREATE INDEX idx_audit_actor    ON audit_log(actor_id);
CREATE INDEX idx_audit_entity   ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_occurred ON audit_log(occurred_at);

-- ================================================================
-- DONE
-- ================================================================
SELECT 'FlexSend database migration complete — 17 tables created' AS status;
