// ================================================================
// FLEXSEND — TYPES PACKAGE
// EVERY ENTITY IN THE SYSTEM DEFINED HERE
// SERVICES NEVER DEFINE THEIR OWN ENTITY SHAPES
// IMPORT FROM HERE OR IT DOES NOT EXIST
// ================================================================

// ================================================================
// ENUMS
// ================================================================

export enum ParcelStatus {
  CREATED                = 'CREATED',
  RIDER_ASSIGNED         = 'RIDER_ASSIGNED',
  RIDER_DISPATCHED       = 'RIDER_DISPATCHED',
  COLLECTED              = 'COLLECTED',
  AT_ORIGIN_OFFICE       = 'AT_ORIGIN_OFFICE',
  MEASURING              = 'MEASURING',
  AWAITING_PAYMENT       = 'AWAITING_PAYMENT',
  REPRICING              = 'REPRICING',
  PACKING                = 'PACKING',
  READY_FOR_COURIER      = 'READY_FOR_COURIER',
  IN_TRANSIT             = 'IN_TRANSIT',
  AT_DEST_OFFICE         = 'AT_DEST_OFFICE',
  OUT_FOR_DELIVERY       = 'OUT_FOR_DELIVERY',
  DELIVERY_ATTEMPTED     = 'DELIVERY_ATTEMPTED',
  DELIVERED              = 'DELIVERED',
  DELIVERY_FAILED        = 'DELIVERY_FAILED',
  RETURN_INITIATED       = 'RETURN_INITIATED',
  RETURN_IN_TRANSIT      = 'RETURN_IN_TRANSIT',
  RETURN_DELIVERED       = 'RETURN_DELIVERED',
  CANCELLED              = 'CANCELLED',
}

export enum UserRole {
  CUSTOMER         = 'CUSTOMER',
  AGENT            = 'AGENT',
  RIDER            = 'RIDER',
  OFFICE_WORKER    = 'OFFICE_WORKER',
  OFFICE_MANAGER   = 'OFFICE_MANAGER',
  BRANCH_MANAGER   = 'BRANCH_MANAGER',
  SUPPORT_AGENT    = 'SUPPORT_AGENT',
  PRICING_MANAGER  = 'PRICING_MANAGER',
  OPS_ADMIN        = 'OPS_ADMIN',
  SUPER_ADMIN      = 'SUPER_ADMIN',
}

export enum Permission {
  // Parcel operations
  BOOK_PARCEL          = 'BOOK_PARCEL',
  SCAN_QR              = 'SCAN_QR',
  MEASURE_PARCEL       = 'MEASURE_PARCEL',
  CONFIRM_MEASUREMENT  = 'CONFIRM_MEASUREMENT',
  PACK_PARCEL          = 'PACK_PARCEL',
  SEAL_BOX             = 'SEAL_BOX',
  DISPATCH_BOX         = 'DISPATCH_BOX',
  RECEIVE_BOX          = 'RECEIVE_BOX',
  ASSIGN_RIDER         = 'ASSIGN_RIDER',
  CONFIRM_DELIVERY     = 'CONFIRM_DELIVERY',

  // Office management
  MANAGE_OFFICE_CONFIG   = 'MANAGE_OFFICE_CONFIG',
  TOGGLE_CAPABILITIES    = 'TOGGLE_CAPABILITIES',
  VIEW_OFFICE_REPORTS    = 'VIEW_OFFICE_REPORTS',
  MANAGE_OFFICE_WORKERS  = 'MANAGE_OFFICE_WORKERS',

  // Rider management
  CREATE_RIDER     = 'CREATE_RIDER',
  ACTIVATE_RIDER   = 'ACTIVATE_RIDER',
  SUSPEND_RIDER    = 'SUSPEND_RIDER',

  // Pricing
  EDIT_PRICING     = 'EDIT_PRICING',
  APPROVE_PRICING  = 'APPROVE_PRICING',

  // Payments
  PROCESS_REFUND   = 'PROCESS_REFUND',
  VIEW_PAYMENTS    = 'VIEW_PAYMENTS',

  // Support
  VIEW_ALL_PARCELS    = 'VIEW_ALL_PARCELS',
  OVERRIDE_STATUS     = 'OVERRIDE_STATUS',
  INITIATE_RETURN     = 'INITIATE_RETURN',
  APPROVE_ROUTE_SWITCH = 'APPROVE_ROUTE_SWITCH',

  // Admin
  MANAGE_AGENTS    = 'MANAGE_AGENTS',
  SYSTEM_CONFIG    = 'SYSTEM_CONFIG',
  VIEW_ANALYTICS   = 'VIEW_ANALYTICS',
  MANAGE_ADMINS    = 'MANAGE_ADMINS',
}

export enum ParcelUniverse {
  UPCOUNTRY = 'UPCOUNTRY',
  IN_REGION  = 'IN_REGION',
}

export enum ParcelSize {
  SMALL       = 'SMALL',
  MEDIUM      = 'MEDIUM',
  LARGE       = 'LARGE',
  EXTRA_LARGE = 'EXTRA_LARGE',
}

export enum CustodyLevel {
  L0 = 'L0', // Booking created
  L1 = 'L1', // Pickup collection
  L2 = 'L2', // Office intake
  L3 = 'L3', // Courier handoff
  L4 = 'L4', // Dest office receipt
  L5 = 'L5', // Last mile collection
  L6 = 'L6', // Delivery confirmation
}

export enum TokenState {
  PENDING   = 'PENDING',
  ACTIVE    = 'ACTIVE',
  CONSUMED  = 'CONSUMED',
  DISCARDED = 'DISCARDED',
  EXPIRED   = 'EXPIRED',
}

export enum TokenType {
  PICKUP       = 'PICKUP',
  DELIVERY     = 'DELIVERY',
  BOX_SEAL     = 'BOX_SEAL',
  BOX_RECEIPT  = 'BOX_RECEIPT',
  LAST_MILE    = 'LAST_MILE',
}

export enum LocationSource {
  HARDWARE_GPS    = 'HARDWARE_GPS',
  RIDER_PHONE     = 'RIDER_PHONE',
  AGENT_PHONE     = 'AGENT_PHONE',
  STATIC_OFFICE   = 'STATIC_OFFICE',
  STATIC_SENDER   = 'STATIC_SENDER',
  STATIC_RECEIVER = 'STATIC_RECEIVER',
}

export enum BoxStatus {
  AVAILABLE   = 'AVAILABLE',
  IN_USE      = 'IN_USE',
  IN_TRANSIT  = 'IN_TRANSIT',
  AT_OFFICE   = 'AT_OFFICE',
  SUSPENDED   = 'SUSPENDED',
  RETIRED     = 'RETIRED',
}

export enum BoxSizeClass {
  S  = 'S',
  M  = 'M',
  L  = 'L',
  XL = 'XL',
}

export enum OfficeType {
  HUB        = 'HUB',
  BRANCH     = 'BRANCH',
  AGENT_ONLY = 'AGENT_ONLY',
}

export enum OfficeStatus {
  ACTIVE    = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  CLOSED    = 'CLOSED',
}

export enum RiderType {
  PICKUP    = 'PICKUP',
  DELIVERY  = 'DELIVERY',
  INTERCITY = 'INTERCITY',
  BOTH      = 'BOTH',
}

export enum RiderStatus {
  ACTIVE    = 'ACTIVE',
  OFFLINE   = 'OFFLINE',
  ON_JOB    = 'ON_JOB',
  SUSPENDED = 'SUSPENDED',
}

export enum PaymentMethod {
  MPESA        = 'MPESA',
  AIRTEL_MONEY = 'AIRTEL_MONEY',
  CASH         = 'CASH',
  CARD         = 'CARD',
}

export enum PaymentStatus {
  PENDING   = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  FAILED    = 'FAILED',
  REFUNDED  = 'REFUNDED',
}

export enum NotificationChannel {
  SMS       = 'SMS',
  PUSH      = 'PUSH',
  WHATSAPP  = 'WHATSAPP',
}

export enum MLAlertLevel {
  LOW    = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH   = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum ReturnType {
  DELIVERY_FAILURE    = 'DELIVERY_FAILURE',
  REJECTED_AT_OFFICE  = 'REJECTED_AT_OFFICE',
  CUSTOMER_CANCELLED  = 'CUSTOMER_CANCELLED',
}

// ================================================================
// CORE ENTITIES
// ================================================================

// ── PARCEL ──────────────────────────────────────────────────────

export interface Parcel {
  parcel_id:          string;
  booking_reference:  string;
  sender_id:          string;
  receiver_phone:     string;
  receiver_name:      string;
  route_code:         string;
  universe:           ParcelUniverse;
  item_category:      string;
  description?:       string;

  // Dimensions — declared at booking
  declared_weight_kg?: number;
  declared_length_cm?: number;
  declared_width_cm?:  number;
  declared_height_cm?: number;
  declared_size:       ParcelSize;

  // Dimensions — confirmed at office
  confirmed_weight_kg?: number;
  confirmed_length_cm?: number;
  confirmed_width_cm?:  number;
  confirmed_height_cm?: number;

  // Pricing
  estimated_price:  number;
  confirmed_price?: number;
  deposit_amount?:  number;

  // Addresses
  pickup_address:   string;
  pickup_lat?:      number;
  pickup_lng?:      number;
  delivery_address: string;
  delivery_lat?:    number;
  delivery_lng?:    number;

  // Office routing
  origin_office_id?: string;
  dest_office_id?:   string;

  // NO STATUS FIELD — status lives in ParcelProjection
  created_at:  string;
  updated_at:  string;
}

// ── PARCEL EVENT (EVENT STORE RECORD) ───────────────────────────

export interface ParcelEvent {
  event_id:   string;
  parcel_id:  string;
  event_type: string;
  payload:    Record<string, any>;
  created_by: string;
  created_at: string;
  version:    string;
}

// ── PARCEL PROJECTION (CURRENT STATE — DERIVED FROM EVENTS) ─────

export interface ParcelProjection {
  parcel_id:          string;
  booking_reference:  string;
  status:             ParcelStatus;
  current_level:      CustodyLevel;
  current_location?:  UnifiedLocation;
  active_rider_id?:   string;
  active_box_id?:     string;
  origin_office_id?:  string;
  dest_office_id?:    string;
  route_code:         string;
  universe:           ParcelUniverse;
  estimated_delivery?: string;
  last_event_type:    string;
  last_event_at:      string;
  updated_at:         string;
}

// ── PARCEL TRACKING VIEW (CUSTOMER-VISIBLE) ──────────────────────

export interface ParcelTrackingView {
  tracking_code:      string;
  status:             ParcelStatus;
  status_label:       string;
  current_location?:  UnifiedLocation;
  rider_name?:        string;
  rider_phone?:       string;
  estimated_delivery?: string;
  timeline:           TrackingTimelineEntry[];
  last_updated:       string;
}

export interface TrackingTimelineEntry {
  level:      CustodyLevel;
  label:      string;
  completed:  boolean;
  timestamp?: string;
  location?:  string;
}

// ── ROUTE CODE ──────────────────────────────────────────────────

export interface RouteCode {
  raw:          string;         // e.g. "A1-B1-C1-D1"
  origin:       'A1' | 'A2' | 'A3';
  transit:      'B0' | 'B1' | 'B2' | 'B1-IR';
  collection?:  'C1' | 'C2';
  last_mile:    'D1' | 'D2';
  special?:     'SP';
  universe:     ParcelUniverse;
  active_levels: CustodyLevel[];
}

// ── CUSTODY TOKEN ───────────────────────────────────────────────

export interface CustodyToken {
  token_id:           string;
  parcel_id:          string;
  level:              CustodyLevel;
  token_type:         TokenType;
  expected_actor_role: UserRole;
  expected_office_id?: string;
  state:              TokenState;
  jwt_payload:        string;
  qr_data:            string;
  expires_at:         string;
  created_at:         string;
  consumed_at?:       string;
  consumed_by?:       string;
}

// ── BOX ─────────────────────────────────────────────────────────

export interface Box {
  box_id:            string;
  box_serial:        string;
  gps_device_id?:    string;
  size_class:        BoxSizeClass;
  home_office_id:    string;
  current_office_id?: string;
  status:            BoxStatus;
  condition_flags:   BoxConditionFlags;
  last_seen_lat?:    number;
  last_seen_lng?:    number;
  battery_pct?:      number;
  created_at:        string;
  updated_at:        string;
}

export interface BoxConditionFlags {
  is_damaged:    boolean;
  is_tampered:   boolean;
  needs_repair:  boolean;
  is_clean:      boolean;
}

// ── BOX PROJECTION ──────────────────────────────────────────────

export interface BoxProjection {
  box_id:           string;
  box_serial:       string;
  status:           BoxStatus;
  current_office_id?: string;
  current_parcel_ids: string[];
  last_location?:   UnifiedLocation;
  battery_pct?:     number;
  is_sealed:        boolean;
  last_event_at:    string;
}

// ── OFFICE ──────────────────────────────────────────────────────

export interface Office {
  office_id:          string;
  office_code:        string;
  name:               string;
  region:             string;
  address:            string;
  lat:                number;
  lng:                number;
  geofence_polygon:   GeoPolygon;
  office_type:        OfficeType;
  status:             OfficeStatus;
  capabilities:       OfficeCapabilities;
  sla_config:         OfficeSLAConfig;
  operating_hours:    OperatingHours;
  config_version:     number;
  manager_id:         string;
  phone?:             string;
  created_at:         string;
  updated_at:         string;
}

export interface OfficeCapabilities {
  has_pickup_riders:              boolean;
  accepts_self_dropoff:           boolean;
  has_active_agents:              boolean;
  has_last_mile_delivery_riders:  boolean;
  has_intercity_dispatch:         boolean;
  has_special_protection_boxing:  boolean;
  accepts_cash_payment:           boolean;
  has_weighing_scale:             boolean;
}

export interface OfficeSLAConfig {
  max_processing_hours:   number;
  max_transit_days:       number;
  max_delivery_attempts:  number;
}

export interface OperatingHours {
  monday:    DayHours | null;
  tuesday:   DayHours | null;
  wednesday: DayHours | null;
  thursday:  DayHours | null;
  friday:    DayHours | null;
  saturday:  DayHours | null;
  sunday:    DayHours | null;
}

export interface DayHours {
  open:  string; // "08:00"
  close: string; // "17:00"
}

// ── OFFICE FLOW TEMPLATE ────────────────────────────────────────

export interface OfficeFlowTemplate {
  template_id:    string;
  office_id:      string;
  route_code:     string;
  steps:          FlowStep[];
  created_at:     string;
}

export interface FlowStep {
  step:           number;
  level:          CustodyLevel;
  action:         string;
  required_role:  UserRole;
  requires_scan:  boolean;
  auto_advance:   boolean;
}

// ── RIDER ───────────────────────────────────────────────────────

export interface Rider {
  rider_id:       string;
  user_id:        string;
  office_id:      string;
  rider_type:     RiderType;
  vehicle_type:   string;
  plate_number?:  string;
  status:         RiderStatus;
  is_verified:    boolean;
  rating:         number;
  total_earnings: number;
  total_jobs:     number;
  created_at:     string;
  updated_at:     string;
}

// ── RIDER PROJECTION ────────────────────────────────────────────

export interface RiderProjection {
  rider_id:         string;
  user_id:          string;
  status:           RiderStatus;
  current_location?: UnifiedLocation;
  active_job_id?:   string;
  active_parcel_id?: string;
  is_online:        boolean;
  last_seen_at:     string;
}

// ── USERS ───────────────────────────────────────────────────────

export interface User {
  user_id:      string;
  phone:        string;
  full_name:    string;
  email?:       string;
  role:         UserRole;
  is_active:    boolean;
  photo_url?:   string;
  fcm_token?:   string;
  created_at:   string;
  updated_at:   string;
}

export interface Customer extends User {
  role:               UserRole.CUSTOMER;
  saved_addresses?:   SavedAddress[];
  total_parcels:      number;
}

export interface Agent extends User {
  role:           UserRole.AGENT;
  office_id:      string;
  territory:      string;
  is_approved:    boolean;
  commission_rate: number;
  total_bookings: number;
}

export interface OfficeWorker extends User {
  role:         UserRole.OFFICE_WORKER | UserRole.OFFICE_MANAGER | UserRole.BRANCH_MANAGER;
  office_id:    string;
  permissions:  Permission[];
  pin_hash:     string;
}

export interface SavedAddress {
  label:    string; // "Home", "Work"
  address:  string;
  lat?:     number;
  lng?:     number;
}

// ── JWT PAYLOAD ─────────────────────────────────────────────────

export interface JWTPayload {
  user_id:     string;
  actor_type:  string;
  role:        UserRole;
  office_id?:  string;
  permissions: Permission[];
  iat:         number;
  exp:         number;
}

// ── LOCATION ────────────────────────────────────────────────────

export interface UnifiedLocation {
  lat:          number;
  lng:          number;
  source:       LocationSource;
  source_id:    string;
  label?:       string;
  is_moving:    boolean;
  last_updated: string;
  is_stale:     boolean;
}

export interface GeoPolygon {
  coordinates: Array<[number, number]>; // [lng, lat] pairs
}

// ── ML ALERT ────────────────────────────────────────────────────

export interface MLAlert {
  alert_id:     string;
  type:         string;
  level:        MLAlertLevel;
  entity_id:    string;
  entity_type:  'parcel' | 'rider' | 'box' | 'office' | 'user';
  score:        number;
  details:      Record<string, any>;
  is_resolved:  boolean;
  created_at:   string;
  resolved_at?: string;
}

// ── NOTIFICATION EVENT ───────────────────────────────────────────

export interface NotificationEvent {
  notification_id:  string;
  user_id:          string;
  phone?:           string;
  fcm_token?:       string;
  channel:          NotificationChannel;
  template_key:     string;
  variables:        Record<string, string>;
  title:            string;
  body:             string;
  data?:            Record<string, any>;
  status:           'PENDING' | 'SENT' | 'FAILED' | 'DELIVERED';
  sent_at?:         string;
  created_at:       string;
}

// ── PAYMENT ─────────────────────────────────────────────────────

export interface Payment {
  payment_id:   string;
  parcel_id:    string;
  user_id:      string;
  amount:       number;
  method:       PaymentMethod;
  status:       PaymentStatus;
  reference?:   string;
  initiated_at: string;
  confirmed_at?: string;
  failed_at?:   string;
}

// ── API RESPONSES ────────────────────────────────────────────────

export interface ApiResponse<T> {
  success:  boolean;
  data?:    T;
  message?: string;
  error?:   string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data:    T[];
  total:   number;
  page:    number;
  limit:   number;
}
