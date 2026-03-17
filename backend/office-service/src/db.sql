-- ============================================================
-- OFFICE SERVICE — COMPLETE DATABASE SCHEMA
-- Run this on Supabase SQL Editor
-- Requires PostGIS extension
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- ── Sequence for booking references ───────────────────────────
CREATE SEQUENCE IF NOT EXISTS booking_ref_seq START 1;

-- ── offices ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS offices (
  office_id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  office_code          VARCHAR(20)  UNIQUE NOT NULL,
  name                 VARCHAR(100) NOT NULL,
  region               VARCHAR(50)  NOT NULL,
  address              TEXT         NOT NULL,
  gps_lat              DECIMAL(10,7) NOT NULL,
  gps_lng              DECIMAL(10,7) NOT NULL,
  geofence_radius_meters INTEGER    NOT NULL DEFAULT 200,
  office_type          VARCHAR(20)  NOT NULL CHECK (office_type IN ('HUB','BRANCH','MINI')),
  status               VARCHAR(20)  NOT NULL DEFAULT 'SETUP'
                         CHECK (status IN ('SETUP','ACTIVE','SUSPENDED','CLOSING','CLOSED')),
  manager_id           UUID,
  capabilities         JSONB        NOT NULL DEFAULT '{}',
  sla_config           JSONB        NOT NULL DEFAULT '{}',
  operating_hours      JSONB        NOT NULL DEFAULT '{}',
  pricing_overrides    JSONB,
  local_surcharge      INTEGER      NOT NULL DEFAULT 0,
  config_version       INTEGER      NOT NULL DEFAULT 1,
  config_updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_offices_status  ON offices(status);
CREATE INDEX IF NOT EXISTS idx_offices_region  ON offices(region);
CREATE INDEX IF NOT EXISTS idx_offices_manager ON offices(manager_id);

-- ── office_coverage_zones ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS office_coverage_zones (
  zone_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id  UUID        NOT NULL REFERENCES offices(office_id) ON DELETE CASCADE,
  zone_type  VARCHAR(20) NOT NULL CHECK (zone_type IN ('PICKUP','DELIVERY')),
  polygon    GEOGRAPHY(POLYGON, 4326) NOT NULL,
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zones_office   ON office_coverage_zones(office_id);
CREATE INDEX IF NOT EXISTS idx_zones_type     ON office_coverage_zones(zone_type);
CREATE INDEX IF NOT EXISTS idx_zones_polygon  ON office_coverage_zones USING GIST(polygon);

-- ── office_sla_config ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS office_sla_config (
  office_id            UUID        NOT NULL REFERENCES offices(office_id),
  sla_type             VARCHAR(50) NOT NULL,
  duration_minutes     INTEGER     NOT NULL,
  escalation_l1_role   VARCHAR(30) DEFAULT 'OFFICE_MANAGER',
  escalation_l2_role   VARCHAR(30) DEFAULT 'BRANCH_MANAGER',
  escalation_l3_role   VARCHAR(30) DEFAULT 'OPS_ADMIN',
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (office_id, sla_type)
);

-- ── office_fees ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS office_fees (
  fee_id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id        UUID        NOT NULL REFERENCES offices(office_id),
  last_mile_fee    INTEGER     NOT NULL DEFAULT 1500,
  local_surcharge  INTEGER     NOT NULL DEFAULT 0,
  effective_from   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── staff_assignments ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_assignments (
  assignment_id UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL,
  office_id     UUID        NOT NULL REFERENCES offices(office_id),
  roles         TEXT[]      NOT NULL DEFAULT '{}',
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  assigned_by   UUID,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, office_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_office ON staff_assignments(office_id);
CREATE INDEX IF NOT EXISTS idx_staff_user   ON staff_assignments(user_id);

-- ── boxes ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS boxes (
  box_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  box_serial          VARCHAR(20) UNIQUE NOT NULL,
  gps_device_id       VARCHAR(20) UNIQUE,
  size_class          VARCHAR(5)  NOT NULL CHECK (size_class IN ('S','M','L','XL')),
  home_office_id      UUID        NOT NULL REFERENCES offices(office_id),
  current_office_id   UUID        REFERENCES offices(office_id),
  status              VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE'
                        CHECK (status IN ('AVAILABLE','LOADING','LOADED','IN_TRANSIT','ARRIVED','MAINTENANCE','DAMAGED','RETIRED')),
  max_weight_kg       DECIMAL     NOT NULL DEFAULT 50,
  last_seen_lat       DECIMAL(10,7),
  last_seen_lng       DECIMAL(10,7),
  last_seen_at        TIMESTAMPTZ,
  battery_pct         INTEGER,
  condition_flags     JSONB       DEFAULT '{"is_damaged":false,"needs_repair":false,"is_clean":true}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_boxes_home_office    ON boxes(home_office_id);
CREATE INDEX IF NOT EXISTS idx_boxes_current_office ON boxes(current_office_id);
CREATE INDEX IF NOT EXISTS idx_boxes_status         ON boxes(status);

-- ── box_parcel_assignments ────────────────────────────────────
CREATE TABLE IF NOT EXISTS box_parcel_assignments (
  assignment_id UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  box_id        UUID        NOT NULL REFERENCES boxes(box_id),
  parcel_id     UUID        NOT NULL,
  assigned_by   UUID,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at    TIMESTAMPTZ,
  UNIQUE (parcel_id)
);

CREATE INDEX IF NOT EXISTS idx_bpa_box    ON box_parcel_assignments(box_id);
CREATE INDEX IF NOT EXISTS idx_bpa_parcel ON box_parcel_assignments(parcel_id);

-- ── intercity_routes ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intercity_routes (
  route_id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  route_code          VARCHAR(50) UNIQUE NOT NULL,
  origin_office_id    UUID        NOT NULL REFERENCES offices(office_id),
  dest_office_id      UUID        NOT NULL REFERENCES offices(office_id),
  departure_schedules JSONB       NOT NULL DEFAULT '{}',
  estimated_hours     DECIMAL     NOT NULL,
  transport_type      VARCHAR(30) NOT NULL,
  max_boxes           INTEGER     NOT NULL DEFAULT 10,
  is_active           BOOLEAN     NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_routes_origin ON intercity_routes(origin_office_id);
CREATE INDEX IF NOT EXISTS idx_routes_dest   ON intercity_routes(dest_office_id);

-- ── transporter_trips ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transporter_trips (
  trip_id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  box_id                   UUID        NOT NULL REFERENCES boxes(box_id),
  origin_office_id         UUID        NOT NULL REFERENCES offices(office_id),
  dest_office_id           UUID        NOT NULL REFERENCES offices(office_id),
  driver_name              VARCHAR(100) NOT NULL,
  driver_phone             VARCHAR(20)  NOT NULL,
  plate_number             VARCHAR(20)  NOT NULL,
  departure_time           TIMESTAMPTZ  NOT NULL,
  estimated_arrival        TIMESTAMPTZ  NOT NULL,
  actual_arrival           TIMESTAMPTZ,
  ml_predicted_arrival     TIMESTAMPTZ,
  ml_sample_count          INTEGER      NOT NULL DEFAULT 0,
  route_key                VARCHAR(100) NOT NULL,
  departure_hour           INTEGER      NOT NULL,
  departure_day_of_week    INTEGER      NOT NULL,
  entered_by               UUID,
  status                   VARCHAR(20)  NOT NULL DEFAULT 'PENDING'
                             CHECK (status IN ('PENDING','IN_TRANSIT','ARRIVED','CANCELLED')),
  notes                    TEXT,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trips_box    ON transporter_trips(box_id);
CREATE INDEX IF NOT EXISTS idx_trips_status ON transporter_trips(status);

-- ── transit_eta_history (ML training data) ────────────────────
CREATE TABLE IF NOT EXISTS transit_eta_history (
  history_id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  route_key            VARCHAR(100) NOT NULL,
  departure_time       TIMESTAMPTZ  NOT NULL,
  estimated_arrival    TIMESTAMPTZ  NOT NULL,
  actual_arrival       TIMESTAMPTZ,
  departure_hour       INTEGER      NOT NULL,
  departure_day_of_week INTEGER     NOT NULL,
  variance_minutes     DECIMAL,
  recorded_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eta_route_key   ON transit_eta_history(route_key);
CREATE INDEX IF NOT EXISTS idx_eta_dept_hour   ON transit_eta_history(departure_hour);
CREATE INDEX IF NOT EXISTS idx_eta_dept_day    ON transit_eta_history(departure_day_of_week);

-- ── pricing_versions ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pricing_versions (
  version_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  label        VARCHAR(100) NOT NULL,
  status       VARCHAR(20)  NOT NULL DEFAULT 'DRAFT'
                 CHECK (status IN ('DRAFT','PENDING_APPROVAL','ACTIVE','ARCHIVED')),
  created_by   UUID,
  approved_by  UUID,
  activated_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── pricing_zones ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pricing_zones (
  zone_id          UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id       UUID     NOT NULL REFERENCES pricing_versions(version_id) ON DELETE CASCADE,
  origin_region    VARCHAR  NOT NULL,
  dest_region      VARCHAR  NOT NULL,
  base_rate_per_kg INTEGER  NOT NULL
);

-- ── weight_brackets ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weight_brackets (
  bracket_id       UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id       UUID     NOT NULL REFERENCES pricing_versions(version_id) ON DELETE CASCADE,
  from_kg          DECIMAL  NOT NULL,
  to_kg            DECIMAL  NOT NULL,
  rate_multiplier  DECIMAL  NOT NULL
);

-- ── category_surcharges ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS category_surcharges (
  surcharge_id      UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id        UUID     NOT NULL REFERENCES pricing_versions(version_id) ON DELETE CASCADE,
  category          VARCHAR  NOT NULL,
  fixed_amount_tzs  INTEGER  NOT NULL DEFAULT 0
);

-- ── sla_breaches ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sla_breaches (
  breach_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id         UUID        NOT NULL,
  sla_type          VARCHAR(50) NOT NULL,
  office_id         UUID        REFERENCES offices(office_id),
  rider_id          UUID,
  expected_by       TIMESTAMPTZ NOT NULL,
  breached_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ,
  breach_duration_mins INTEGER,
  notified_roles    TEXT[]      DEFAULT '{}',
  excused           BOOLEAN     NOT NULL DEFAULT false,
  excuse_reason     TEXT,
  excused_by        UUID,
  excuse_at         TIMESTAMPTZ,
  UNIQUE (parcel_id, sla_type)
);

CREATE INDEX IF NOT EXISTS idx_breaches_parcel ON sla_breaches(parcel_id);
CREATE INDEX IF NOT EXISTS idx_breaches_office ON sla_breaches(office_id);

-- ── sla_pauses ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sla_pauses (
  pause_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id   UUID        NOT NULL REFERENCES offices(office_id),
  reason      TEXT        NOT NULL,
  paused_by   UUID,
  resumed_by  UUID,
  paused_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resumed_at  TIMESTAMPTZ
);

-- ── audit_log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  log_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     UUID,
  actor_role   VARCHAR(30),
  action       VARCHAR(100) NOT NULL,
  entity_type  VARCHAR(50)  NOT NULL,
  entity_id    VARCHAR(100),
  before_state JSONB,
  after_state  JSONB,
  occurred_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor  ON audit_log(actor_id);
