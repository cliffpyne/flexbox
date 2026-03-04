import { CustodyLevel, UserRole, Permission } from '@flexbox/types';

export const ROUTE_CODES = {
  // ── UPCOUNTRY — 24 COMBINATIONS ─────────────────────────────
  'A1-B1-C1-D1': { description: 'Full flow — all riders',               universe: 'UPCOUNTRY', levels: [CustodyLevel.L1, CustodyLevel.L2, CustodyLevel.L3, CustodyLevel.L4, CustodyLevel.L5, CustodyLevel.L6] },
  'A1-B1-C1-D2': { description: 'Rider pickup, self-pickup dest',        universe: 'UPCOUNTRY', levels: [CustodyLevel.L1, CustodyLevel.L2, CustodyLevel.L3, CustodyLevel.L4, CustodyLevel.L6] },
  'A1-B1-C2-D1': { description: 'Rider pickup, staff collect, delivers', universe: 'UPCOUNTRY', levels: [CustodyLevel.L1, CustodyLevel.L2, CustodyLevel.L3, CustodyLevel.L4, CustodyLevel.L5, CustodyLevel.L6] },
  'A1-B1-C2-D2': { description: 'Rider pickup, staff collect, self-pickup', universe: 'UPCOUNTRY', levels: [CustodyLevel.L1, CustodyLevel.L2, CustodyLevel.L3, CustodyLevel.L4, CustodyLevel.L6] },
  'A1-B2-C1-D1': { description: 'Rider pickup, staff to courier, delivers', universe: 'UPCOUNTRY', levels: [CustodyLevel.L1, CustodyLevel.L2, CustodyLevel.L3, CustodyLevel.L4, CustodyLevel.L5, CustodyLevel.L6] },
  'A1-B2-C1-D2': { description: 'Rider pickup, staff to courier, self-pickup', universe: 'UPCOUNTRY', levels: [CustodyLevel.L1, CustodyLevel.L2, CustodyLevel.L3, CustodyLevel.L4, CustodyLevel.L6] },
  'A1-B2-C2-D1': { description: 'Rider pickup, all staff, delivers',    universe: 'UPCOUNTRY', levels: [CustodyLevel.L1, CustodyLevel.L2, CustodyLevel.L3, CustodyLevel.L4, CustodyLevel.L5, CustodyLevel.L6] },
  'A1-B2-C2-D2': { description: 'Rider pickup, all staff, self-pickup', universe: 'UPCOUNTRY', levels: [CustodyLevel.L1, CustodyLevel.L2, CustodyLevel.L3, CustodyLevel.L4, CustodyLevel.L6] },
  'A2-B1-C1-D1': { description: 'Self-drop, office rider, delivers',    universe: 'UPCOUNTRY', levels: [CustodyLevel.L2, CustodyLevel.L3, CustodyLevel.L4, CustodyLevel.L5, CustodyLevel.L6] },
  'A2-B1-C1-D2': { description: 'Self-drop, office rider, self-pickup', universe: 'UPCOUNTRY', levels: [CustodyLevel.L2, CustodyLevel.L3, CustodyLevel.L4, CustodyLevel.L6] },
  'A2-B1-C2-D1': { description: 'Self-drop, staff collect, delivers',   universe: 'UPCOUNTRY', levels: [CustodyLevel.L2, CustodyLevel.L3, CustodyLevel.L4, CustodyLevel.L5, CustodyLevel.L6] },
  'A2-B1-C2-D2': { description: 'Self-drop, staff collect, self-pickup',universe: 'UPCOUNTRY', levels: [CustodyLevel.L2, CustodyLevel.L3, CustodyLevel.L4, CustodyLevel.L6] },
  'A2-B2-C1-D1': { description: 'Self-drop, staff to courier, delivers',universe: 'UPCOUNTRY', levels: [CustodyLevel.L2, CustodyLevel.L3, CustodyLevel.L4, CustodyLevel.L5, CustodyLevel.L6] },
  'A2-B2-C1-D2': { description: 'Self-drop, staff to courier, self-pickup', universe: 'UPCOUNTRY', levels: [CustodyLevel.L2, CustodyLevel.L3, CustodyLevel.L4, CustodyLevel.L6] },
  'A2-B2-C2-D1': { description: 'Self-drop, all staff, delivers',       universe: 'UPCOUNTRY', levels: [CustodyLevel.L2, CustodyLevel.L3, CustodyLevel.L4, CustodyLevel.L5, CustodyLevel.L6] },
  'A2-B2-C2-D2': { description: 'All self/staff — no riders',           universe: 'UPCOUNTRY', levels: [CustodyLevel.L2, CustodyLevel.L3, CustodyLevel.L4, CustodyLevel.L6] },
  'A3-B1-C1-D1': { description: 'Agent, full riders',                   universe: 'UPCOUNTRY', levels: [CustodyLevel.L2, CustodyLevel.L3, CustodyLevel.L4, CustodyLevel.L5, CustodyLevel.L6] },
  'A3-B1-C1-D2': { description: 'Agent, rider to courier, self-pickup', universe: 'UPCOUNTRY', levels: [CustodyLevel.L2, CustodyLevel.L3, CustodyLevel.L4, CustodyLevel.L6] },
  'A3-B1-C2-D1': { description: 'Agent, rider to courier, staff collect, delivers', universe: 'UPCOUNTRY', levels: [CustodyLevel.L2, CustodyLevel.L3, CustodyLevel.L4, CustodyLevel.L5, CustodyLevel.L6] },
  'A3-B1-C2-D2': { description: 'Agent, rider to courier, staff collect, self-pickup', universe: 'UPCOUNTRY', levels: [CustodyLevel.L2, CustodyLevel.L3, CustodyLevel.L4, CustodyLevel.L6] },
  'A3-B2-C1-D1': { description: 'Agent, staff to courier, delivers',    universe: 'UPCOUNTRY', levels: [CustodyLevel.L2, CustodyLevel.L3, CustodyLevel.L4, CustodyLevel.L5, CustodyLevel.L6] },
  'A3-B2-C1-D2': { description: 'Agent, staff to courier, self-pickup', universe: 'UPCOUNTRY', levels: [CustodyLevel.L2, CustodyLevel.L3, CustodyLevel.L4, CustodyLevel.L6] },
  'A3-B2-C2-D1': { description: 'Agent, all staff, delivers',           universe: 'UPCOUNTRY', levels: [CustodyLevel.L2, CustodyLevel.L3, CustodyLevel.L4, CustodyLevel.L5, CustodyLevel.L6] },
  'A3-B2-C2-D2': { description: 'Agent, all staff, self-pickup',        universe: 'UPCOUNTRY', levels: [CustodyLevel.L2, CustodyLevel.L3, CustodyLevel.L4, CustodyLevel.L6] },

  // ── IN-REGION — 11 COMBINATIONS ──────────────────────────────
  'A1-B0-D1':    { description: 'Bolt-style direct door to door',        universe: 'IN_REGION', levels: [CustodyLevel.L1, CustodyLevel.L6] },
  'A1-B1-IR-D1': { description: 'Rider, via office, last mile delivers', universe: 'IN_REGION', levels: [CustodyLevel.L1, CustodyLevel.L2, CustodyLevel.L5, CustodyLevel.L6] },
  'A1-B1-IR-D2': { description: 'Rider, via office, self-pickup',        universe: 'IN_REGION', levels: [CustodyLevel.L1, CustodyLevel.L2, CustodyLevel.L6] },
  'A2-B1-IR-D1': { description: 'Self-drop, last mile delivers',         universe: 'IN_REGION', levels: [CustodyLevel.L2, CustodyLevel.L5, CustodyLevel.L6] },
  'A2-B1-IR-D2': { description: 'Self-drop, receiver collects',          universe: 'IN_REGION', levels: [CustodyLevel.L2, CustodyLevel.L6] },
  'A3-B0-D1':    { description: 'Agent books, direct rider delivers',    universe: 'IN_REGION', levels: [CustodyLevel.L1, CustodyLevel.L6] },
  'A3-B1-IR-D1': { description: 'Agent, via office, last mile delivers', universe: 'IN_REGION', levels: [CustodyLevel.L2, CustodyLevel.L5, CustodyLevel.L6] },
  'A3-B1-IR-D2': { description: 'Agent, via office, self-pickup',        universe: 'IN_REGION', levels: [CustodyLevel.L2, CustodyLevel.L6] },
  'A1-SP-D1':    { description: 'Rider, special box, protected delivery',universe: 'IN_REGION', levels: [CustodyLevel.L1, CustodyLevel.L2, CustodyLevel.L5, CustodyLevel.L6] },
  'A2-SP-D1':    { description: 'Self-drop, special box, delivers',      universe: 'IN_REGION', levels: [CustodyLevel.L2, CustodyLevel.L5, CustodyLevel.L6] },
  'A2-SP-D2':    { description: 'Self-drop, special box, self-pickup',   universe: 'IN_REGION', levels: [CustodyLevel.L2, CustodyLevel.L6] },
} as const;

export type RouteCodeKey = keyof typeof ROUTE_CODES;

export const TOKEN_TTL = {
  L1: 4   * 60 * 60,
  L2: 48  * 60 * 60,
  L3: 72  * 60 * 60,
  L4: 168 * 60 * 60,
  L5: 24  * 60 * 60,
  L6: 15  * 60,
} as const;

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.CUSTOMER]: [
    Permission.BOOK_PARCEL,
  ],
  [UserRole.AGENT]: [
    Permission.BOOK_PARCEL,
  ],
  [UserRole.RIDER]: [
    Permission.SCAN_QR,
  ],
  [UserRole.OFFICE_WORKER]: [
    Permission.SCAN_QR,
    Permission.MEASURE_PARCEL,
    Permission.CONFIRM_MEASUREMENT,
    Permission.PACK_PARCEL,
    Permission.SEAL_BOX,
    Permission.DISPATCH_BOX,
    Permission.RECEIVE_BOX,
  ],
  [UserRole.OFFICE_MANAGER]: [
    Permission.SCAN_QR,
    Permission.MEASURE_PARCEL,
    Permission.CONFIRM_MEASUREMENT,
    Permission.PACK_PARCEL,
    Permission.SEAL_BOX,
    Permission.DISPATCH_BOX,
    Permission.RECEIVE_BOX,
    Permission.ASSIGN_RIDER,
    Permission.MANAGE_OFFICE_CONFIG,
    Permission.TOGGLE_CAPABILITIES,
    Permission.VIEW_OFFICE_REPORTS,
    Permission.MANAGE_OFFICE_WORKERS,
    Permission.CREATE_RIDER,
    Permission.ACTIVATE_RIDER,
    Permission.SUSPEND_RIDER,
    Permission.VIEW_PAYMENTS,
    Permission.INITIATE_RETURN,
  ],
  [UserRole.BRANCH_MANAGER]: [
    Permission.SCAN_QR,
    Permission.MEASURE_PARCEL,
    Permission.CONFIRM_MEASUREMENT,
    Permission.PACK_PARCEL,
    Permission.SEAL_BOX,
    Permission.DISPATCH_BOX,
    Permission.RECEIVE_BOX,
    Permission.ASSIGN_RIDER,
    Permission.MANAGE_OFFICE_CONFIG,
    Permission.TOGGLE_CAPABILITIES,
    Permission.VIEW_OFFICE_REPORTS,
    Permission.MANAGE_OFFICE_WORKERS,
    Permission.CREATE_RIDER,
    Permission.ACTIVATE_RIDER,
    Permission.SUSPEND_RIDER,
    Permission.VIEW_PAYMENTS,
    Permission.INITIATE_RETURN,
    Permission.APPROVE_ROUTE_SWITCH,
    Permission.VIEW_ANALYTICS,
  ],
  [UserRole.SUPPORT_AGENT]: [
    Permission.VIEW_ALL_PARCELS,
    Permission.OVERRIDE_STATUS,
    Permission.INITIATE_RETURN,
    Permission.VIEW_PAYMENTS,
    Permission.APPROVE_ROUTE_SWITCH,
  ],
  [UserRole.PRICING_MANAGER]: [
    Permission.EDIT_PRICING,
    Permission.VIEW_PAYMENTS,
    Permission.VIEW_ANALYTICS,
  ],
  [UserRole.OPS_ADMIN]: [
    Permission.BOOK_PARCEL,
    Permission.SCAN_QR,
    Permission.MEASURE_PARCEL,
    Permission.CONFIRM_MEASUREMENT,
    Permission.PACK_PARCEL,
    Permission.SEAL_BOX,
    Permission.DISPATCH_BOX,
    Permission.RECEIVE_BOX,
    Permission.ASSIGN_RIDER,
    Permission.MANAGE_OFFICE_CONFIG,
    Permission.TOGGLE_CAPABILITIES,
    Permission.VIEW_OFFICE_REPORTS,
    Permission.MANAGE_OFFICE_WORKERS,
    Permission.CREATE_RIDER,
    Permission.ACTIVATE_RIDER,
    Permission.SUSPEND_RIDER,
    Permission.EDIT_PRICING,
    Permission.APPROVE_PRICING,
    Permission.PROCESS_REFUND,
    Permission.VIEW_PAYMENTS,
    Permission.VIEW_ALL_PARCELS,
    Permission.OVERRIDE_STATUS,
    Permission.INITIATE_RETURN,
    Permission.APPROVE_ROUTE_SWITCH,
    Permission.MANAGE_AGENTS,
    Permission.VIEW_ANALYTICS,
  ],
  [UserRole.SUPER_ADMIN]: [
    Permission.BOOK_PARCEL,
    Permission.SCAN_QR,
    Permission.MEASURE_PARCEL,
    Permission.CONFIRM_MEASUREMENT,
    Permission.PACK_PARCEL,
    Permission.SEAL_BOX,
    Permission.DISPATCH_BOX,
    Permission.RECEIVE_BOX,
    Permission.ASSIGN_RIDER,
    Permission.MANAGE_OFFICE_CONFIG,
    Permission.TOGGLE_CAPABILITIES,
    Permission.VIEW_OFFICE_REPORTS,
    Permission.MANAGE_OFFICE_WORKERS,
    Permission.CREATE_RIDER,
    Permission.ACTIVATE_RIDER,
    Permission.SUSPEND_RIDER,
    Permission.EDIT_PRICING,
    Permission.APPROVE_PRICING,
    Permission.PROCESS_REFUND,
    Permission.VIEW_PAYMENTS,
    Permission.VIEW_ALL_PARCELS,
    Permission.OVERRIDE_STATUS,
    Permission.INITIATE_RETURN,
    Permission.APPROVE_ROUTE_SWITCH,
    Permission.MANAGE_AGENTS,
    Permission.SYSTEM_CONFIG,
    Permission.VIEW_ANALYTICS,
    Permission.MANAGE_ADMINS,
    Permission.CONFIRM_DELIVERY,
  ],
};

export const SLA = {
  PICKUP_WINDOW_SECS:      2  * 60 * 60,
  OFFICE_INTAKE_SECS:      4  * 60 * 60,
  PACKING_SECS:            6  * 60 * 60,
  SAME_CITY_DELIVERY_SECS: 24 * 60 * 60,
  LAST_MILE_SECS:          6  * 60 * 60,
  REPRICE_WINDOW_SECS:     30 * 60,
  RETURN_WINDOW_SECS:      48 * 60 * 60,
  OFFICE_STORAGE_DAYS:     7,
  OFFICE_DISPOSAL_DAYS:    30,
} as const;

export const BOX_DIMENSIONS = {
  S:  { label: 'Small',       length_cm: 28, width_cm: 18, height_cm: 13, max_weight_kg: 5  },
  M:  { label: 'Medium',      length_cm: 43, width_cm: 33, height_cm: 23, max_weight_kg: 15 },
  L:  { label: 'Large',       length_cm: 58, width_cm: 43, height_cm: 33, max_weight_kg: 30 },
  XL: { label: 'Extra Large', length_cm: 78, width_cm: 58, height_cm: 48, max_weight_kg: 50 },
} as const;

export const REDIS_KEYS = {
  parcelProjection: (id: string) => `parcel:${id}:projection`,
  parcelTracking:   (id: string) => `parcel:${id}:tracking`,
  riderLocation:    (id: string) => `rider:${id}:location`,
  tokenValid:       (id: string) => `token:${id}:valid`,
  otp:              (phone: string) => `otp:${phone}`,
  rateLimitUser:    (uid: string, endpoint: string) => `ratelimit:${uid}:${endpoint}`,
  geoRiders:        (officeId: string) => `geo:riders:${officeId}`,
  geoOffices:       () => `geo:offices`,
  session:          (uid: string) => `session:${uid}`,
  officeDashboard:  (id: string) => `office:${id}:dashboard`,
} as const;

export const REDIS_CHANNELS = {
  parcelTracking:   (id: string)    => `parcel:${id}:tracking`,
  parcelInternal:   (id: string)    => `parcel:${id}:internal`,
  officeOperations: (id: string)    => `office:${id}:operations`,
  riderJobs:        (id: string)    => `rider:${id}:jobs`,
  opsOverview:      ()              => `ops:network:overview`,
  mlAlerts:         (level: string) => `ml:alerts:${level}`,
} as const;

export const REDIS_TTL = {
  PARCEL_PROJECTION_SECS: 30 * 24 * 60 * 60,
  RIDER_LOCATION_SECS:    5  * 60,
  SESSION_SECS:           30 * 60,
  OFFICE_DASHBOARD_SECS:  60 * 60,
  RATE_LIMIT_SECS:        60,
} as const;

export const ERROR_CODES = {
  AUTH_001: { code: 'AUTH_001', message: 'Invalid or missing token' },
  AUTH_002: { code: 'AUTH_002', message: 'Token expired' },
  AUTH_003: { code: 'AUTH_003', message: 'Invalid OTP' },
  AUTH_004: { code: 'AUTH_004', message: 'OTP expired' },
  AUTH_005: { code: 'AUTH_005', message: 'Too many OTP requests' },
  AUTH_006: { code: 'AUTH_006', message: 'Invalid PIN' },
  AUTH_007: { code: 'AUTH_007', message: 'Account suspended' },
  AUTH_008: { code: 'AUTH_008', message: 'Insufficient permissions' },
  PARCEL_001: { code: 'PARCEL_001', message: 'Parcel not found' },
  PARCEL_002: { code: 'PARCEL_002', message: 'Invalid route code' },
  PARCEL_003: { code: 'PARCEL_003', message: 'Parcel cannot be modified at current status' },
  PARCEL_004: { code: 'PARCEL_004', message: 'Measurement mismatch exceeds threshold' },
  PARCEL_005: { code: 'PARCEL_005', message: 'Return window expired' },
  TOKEN_001: { code: 'TOKEN_001', message: 'Token not found' },
  TOKEN_002: { code: 'TOKEN_002', message: 'Token expired' },
  TOKEN_003: { code: 'TOKEN_003', message: 'Token already consumed' },
  TOKEN_004: { code: 'TOKEN_004', message: 'Token discarded — route changed' },
  TOKEN_005: { code: 'TOKEN_005', message: 'Wrong actor for this token' },
  BOX_001: { code: 'BOX_001', message: 'Box not available' },
  BOX_002: { code: 'BOX_002', message: 'Box capacity exceeded' },
  OFFICE_001: { code: 'OFFICE_001', message: 'Office not found' },
  OFFICE_002: { code: 'OFFICE_002', message: 'Office does not support this capability' },
  OFFICE_003: { code: 'OFFICE_003', message: 'Office suspended' },
  PAYMENT_001: { code: 'PAYMENT_001', message: 'Payment failed' },
  PAYMENT_002: { code: 'PAYMENT_002', message: 'Payment already processed' },
} as const;

export const OTP = {
  LENGTH:       6,
  EXPIRY_SECS:  10 * 60,
  MAX_ATTEMPTS: 3,
  RATE_LIMIT:   3,
} as const;

export const JWT = {
  ACCESS_TOKEN_TTL_SECS:  15 * 60,
  REFRESH_TOKEN_TTL_SECS: 30 * 24 * 60 * 60,
  ALGORITHM:              'RS256',
} as const;

export const TRACKING_CODE_PREFIX = 'FBX';

export const PRICING = {
  BASE_FARE:             2000,
  PER_KM:                500,
  SMALL_PARCEL:          3000,
  MEDIUM_PARCEL:         5000,
  LARGE_PARCEL:          8000,
  EXTRA_LARGE_PARCEL:    12000,
  INSURANCE_RATE:        0.01,
  RIDER_COMMISSION:      0.80,
  PLATFORM_FEE:          0.20,
  AGENT_COMMISSION:      0.05,
  MEASUREMENT_TOLERANCE: 0.10,
} as const;

export const GEO = {
  DEFAULT_OFFICE_GEOFENCE_RADIUS_METERS: 100,
  ARRIVING_RADIUS_METERS:                500,
  MAX_RIDER_SEARCH_KM:                   10,
  BOX_PING_INTERVAL_MOVING_SECS:         30,
  BOX_PING_INTERVAL_STATIONARY_SECS:     300,
  BOX_BATTERY_ALERT_PCT:                 20,
  BOX_MISSING_ALERT_HOURS:               2,
} as const;

export const FRAUD = {
  MISMATCH_THRESHOLD_MINOR: 0.10,
  MISMATCH_THRESHOLD_MAJOR: 0.20,
  MISMATCHES_BEFORE_FLAG:   3,
  MISMATCH_WINDOW_DAYS:     30,
} as const;

export const RATE_LIMITS = {
  CUSTOMER_ENDPOINTS: 100,
  INTERNAL_SERVICES:  500,
  AUTH_ENDPOINTS:     20,
} as const;
