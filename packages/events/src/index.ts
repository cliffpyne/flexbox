// ================================================================
// FLEXSEND — EVENTS PACKAGE
// THE MOST CRITICAL FILE IN THE CODEBASE
// FREEZE BEFORE BUILDING ANY SERVICE
// DO NOT RENAME OR REMOVE EVENTS ONCE A SERVICE IS BUILT ON THEM
// ================================================================

export const EVENTS = {

  // ── PARCEL LIFECYCLE ──────────────────────────────────────────
  PARCEL_CREATED:                               'parcel.created',
  PARCEL_ROUTE_ASSIGNED:                        'parcel.route_assigned',
  PARCEL_RIDER_ASSIGNED:                        'parcel.rider_assigned',
  PARCEL_RIDER_DISPATCHED:                      'parcel.rider_dispatched',
  PARCEL_RIDER_ARRIVED_AT_SENDER:               'parcel.rider_arrived_at_sender',
  PARCEL_COLLECTED_BY_RIDER:                    'parcel.collected_by_rider',

  // ── PARCEL AT OFFICE ──────────────────────────────────────────
  PARCEL_SENDER_SELF_DROPOFF:                   'parcel.sender_self_dropoff',
  PARCEL_AGENT_DROPOFF:                         'parcel.agent_dropoff',
  PARCEL_OFFICE_RECEIVED:                       'parcel.office_received',
  PARCEL_MEASUREMENT_DECLARED:                  'parcel.measurement_declared',
  PARCEL_MEASUREMENT_CONFIRMED:                 'parcel.measurement_confirmed',
  PARCEL_MEASUREMENT_MISMATCH_FLAGGED:          'parcel.measurement_mismatch_flagged',
  PARCEL_PACKING_INSTRUCTION_GENERATED:         'parcel.packing_instruction_generated',
  PARCEL_OFFICE_RIDER_ASSIGNED_TO_COURIER:      'parcel.office_rider_assigned_to_courier',

  // ── REPRICING ─────────────────────────────────────────────────
  PARCEL_REPRICING_TRIGGERED:                   'parcel.repricing_triggered',
  PARCEL_REPRICING_ACCEPTED:                    'parcel.repricing_accepted',
  PARCEL_REPRICING_REJECTED:                    'parcel.repricing_rejected',

  // ── BOXING & TRANSIT ──────────────────────────────────────────
  PARCEL_BOX_ASSIGNED:                          'parcel.box_assigned',
  PARCEL_PACKED_INTO_BOX:                       'parcel.packed_into_box',
  PARCEL_BOX_SEALED:                            'parcel.box_sealed',
  PARCEL_BOX_HANDED_TO_COURIER:                 'parcel.box_handed_to_courier',
  PARCEL_IN_INTERCITY_TRANSIT:                  'parcel.in_intercity_transit',
  PARCEL_BOX_ARRIVED_GEOFENCE:                  'parcel.box_arrived_geofence',

  // ── DESTINATION ───────────────────────────────────────────────
  PARCEL_BOX_RECEIVED_AT_DEST_OFFICE:           'parcel.box_received_at_dest_office',
  PARCEL_UNPACKED_FROM_BOX:                     'parcel.unpacked_from_box',
  PARCEL_LAST_MILE_RIDER_ASSIGNED:              'parcel.last_mile_rider_assigned',
  PARCEL_LAST_MILE_RIDER_DISPATCHED:            'parcel.last_mile_rider_dispatched',
  PARCEL_LAST_MILE_RIDER_ARRIVED_AT_RECEIVER:   'parcel.last_mile_rider_arrived_at_receiver',

  // ── DELIVERY ──────────────────────────────────────────────────
  PARCEL_DELIVERY_ATTEMPTED:                    'parcel.delivery_attempted',
  PARCEL_DELIVERY_CONFIRMED:                    'parcel.delivery_confirmed',
  PARCEL_DELIVERY_FAILED:                       'parcel.delivery_failed',

  // ── RETURNS ───────────────────────────────────────────────────
  PARCEL_RETURN_INITIATED_DELIVERY_FAILURE:     'parcel.return_initiated.delivery_failure',
  PARCEL_RETURN_INITIATED_REJECTED_AT_OFFICE:   'parcel.return_initiated.rejected_at_office',
  PARCEL_RETURN_COLLECTED:                      'parcel.return_collected',
  PARCEL_RETURN_IN_TRANSIT:                     'parcel.return_in_transit',
  PARCEL_RETURN_ARRIVED_ORIGIN:                 'parcel.return_arrived_origin',
  PARCEL_RETURN_DELIVERED_TO_SENDER:            'parcel.return_delivered_to_sender',

  // ── ROUTE & TOKENS ────────────────────────────────────────────
  ROUTE_SWITCH_REQUESTED:                       'route.switch_requested',
  ROUTE_SWITCH_APPROVED:                        'route.switch_approved',
  ROUTE_SWITCH_EXECUTED:                        'route.switch_executed',
  TOKEN_ACTIVATED:                              'token.activated',
  TOKEN_CONSUMED:                               'token.consumed',
  TOKEN_DISCARDED:                              'token.discarded',
  TOKEN_EXPIRED:                                'token.expired',

  // ── BOX ───────────────────────────────────────────────────────
  BOX_CREATED:                                  'box.created',
  BOX_ASSIGNED_TO_PARCEL:                       'box.assigned_to_parcel',
  BOX_SEALED:                                   'box.sealed',
  BOX_DISPATCHED_TO_COURIER:                    'box.dispatched_to_courier',
  BOX_GPS_PING:                                 'box.gps_ping',
  BOX_ENTERED_OFFICE_GEOFENCE:                  'box.entered_office_geofence',
  BOX_EXITED_OFFICE_GEOFENCE:                   'box.exited_office_geofence',
  BOX_RECEIVED_AT_OFFICE:                       'box.received_at_office',
  BOX_UNPACKED:                                 'box.unpacked',
  BOX_ABNORMALITY_REPORTED:                     'box.abnormality_reported',
  BOX_MISSING_ALERT:                            'box.missing_alert',
  BOX_SUSPENDED:                                'box.suspended',
  BOX_RESTORED:                                 'box.restored',
  BOX_RETIRED:                                  'box.retired',

  // ── RIDER ─────────────────────────────────────────────────────
  RIDER_LOCATION_UPDATED:                       'rider.location_updated',
  RIDER_JOB_ASSIGNED:                           'rider.job_assigned',
  RIDER_JOB_ACCEPTED:                           'rider.job_accepted',
  RIDER_JOB_STARTED:                            'rider.job_started',
  RIDER_JOB_COMPLETED:                          'rider.job_completed',
  RIDER_JOB_CANCELLED:                          'rider.job_cancelled',
  RIDER_WENT_ONLINE:                            'rider.went_online',
  RIDER_WENT_OFFLINE:                           'rider.went_offline',

  // ── OFFICE ────────────────────────────────────────────────────
  OFFICE_CREATED:                               'office.created',
  OFFICE_CONFIG_UPDATED:                        'office.config_updated',
  OFFICE_CAPABILITY_TOGGLED:                    'office.capability_toggled',
  OFFICE_SUSPENDED:                             'office.suspended',

  // ── USERS ─────────────────────────────────────────────────────
  USER_REGISTERED:                              'user.registered',
  USER_VERIFIED:                                'user.verified',
  USER_PROFILE_UPDATED:                         'user.profile_updated',
  AGENT_APPROVED:                               'user.agent_approved',
  AGENT_SUSPENDED:                              'user.agent_suspended',
  RIDER_CREATED:                                'user.rider_created',
  RIDER_ACTIVATED:                              'user.rider_activated',

  // ── ML ────────────────────────────────────────────────────────
  ML_ALERT_GENERATED:                           'ml.alert_generated',
  ML_ROUTE_RECOMMENDATION_CREATED:              'ml.route_recommendation_created',
  ML_ROUTE_RECOMMENDATION_APPROVED:             'ml.route_recommendation_approved',
  ML_ROUTE_RECOMMENDATION_REJECTED:             'ml.route_recommendation_rejected',
  ML_RIDER_SCORE_COMPUTED:                      'ml.rider_score_computed',
  ML_ETA_COMPUTED:                              'ml.eta_computed',
  ML_FRAUD_SCORE_COMPUTED:                      'ml.fraud_score_computed',

  // ── PAYMENT ───────────────────────────────────────────────────
  PAYMENT_DEPOSIT_INITIATED:                    'payment.deposit_initiated',
  PAYMENT_DEPOSIT_CONFIRMED:                    'payment.deposit_confirmed',
  PAYMENT_DEPOSIT_FAILED:                       'payment.deposit_failed',
  PAYMENT_REFUND_INITIATED:                     'payment.refund_initiated',
  AGENT_COMMISSION_EARNED:                      'payment.agent_commission_earned',
  RIDER_EARNING_CREDITED:                       'payment.rider_earning_credited',

  // ── NOTIFICATION ──────────────────────────────────────────────
  NOTIFICATION_SENT:                            'notification.sent',
  NOTIFICATION_FAILED:                          'notification.failed',
  NOTIFICATION_DELIVERED:                       'notification.delivered',

} as const;

export type EventName = typeof EVENTS[keyof typeof EVENTS];

// ─── BASE EVENT ─────────────────────────────────────────────────

export interface BaseEvent<T extends EventName, P> {
  event:     T;
  payload:   P;
  timestamp: string;
  service:   string;
  version:   '1.0';
}

// ================================================================
// PAYLOAD INTERFACES
// ================================================================

// ── PARCEL LIFECYCLE ────────────────────────────────────────────

export interface ParcelCreatedPayload {
  parcel_id:        string;
  tracking_code:    string;
  sender_id:        string;
  sender_phone:     string;
  recipient_name:   string;
  recipient_phone:  string;
  pickup_address:   string;
  pickup_lat?:      number;
  pickup_lng?:      number;
  delivery_address: string;
  delivery_lat?:    number;
  delivery_lng?:    number;
  size:             string;
  price:            number;
  route_code?:      string;
  created_at:       string;
}

export interface ParcelRouteAssignedPayload {
  parcel_id:         string;
  route_code:        string;
  universe:          'upcountry' | 'in_region';
  origin_office_id?: string;
  dest_office_id?:   string;
  assigned_by:       string;
}

export interface ParcelRiderAssignedPayload {
  parcel_id:   string;
  rider_id:    string;
  job_id:      string;
  stage:       'pickup' | 'last_mile' | 'intercity';
  assigned_at: string;
}

export interface ParcelRiderDispatchedPayload {
  parcel_id:     string;
  rider_id:      string;
  job_id:        string;
  dispatched_at: string;
}

export interface ParcelRiderArrivedAtSenderPayload {
  parcel_id:  string;
  rider_id:   string;
  arrived_at: string;
  lat:        number;
  lng:        number;
}

export interface ParcelCollectedByRiderPayload {
  parcel_id:    string;
  rider_id:     string;
  token_id:     string;
  collected_at: string;
  lat:          number;
  lng:          number;
}

// ── PARCEL AT OFFICE ────────────────────────────────────────────

export interface ParcelOfficeReceivedPayload {
  parcel_id:   string;
  office_id:   string;
  worker_id:   string;
  received_at: string;
  stage:       'origin' | 'destination';
}

export interface ParcelMeasurementPayload {
  parcel_id:       string;
  worker_id:       string;
  weight_kg:       number;
  length_cm:       number;
  width_cm:        number;
  height_cm:       number;
  declared_price?: number;
  measured_at:     string;
}

export interface ParcelMeasurementMismatchPayload {
  parcel_id:        string;
  worker_id:        string;
  declared_weight:  number;
  actual_weight:    number;
  price_difference: number;
  flagged_at:       string;
}

export interface ParcelPackingInstructionPayload {
  parcel_id:    string;
  box_id:       string;
  instructions: string;
  generated_by: string;
  generated_at: string;
}

export interface ParcelOfficeRiderAssignedToCourierPayload {
  parcel_id:    string;
  box_id:       string;
  rider_id:     string;
  office_id:    string;
  courier_name: string;
  assigned_at:  string;
}

// ── REPRICING ───────────────────────────────────────────────────

export interface ParcelRepricingPayload {
  parcel_id:    string;
  old_price:    number;
  new_price:    number;
  reason:       string;
  triggered_by: string;
  triggered_at: string;
}

export interface ParcelRepricingResponsePayload {
  parcel_id:    string;
  customer_id:  string;
  response:     'accepted' | 'rejected';
  responded_at: string;
}

// ── BOXING & TRANSIT ────────────────────────────────────────────

export interface ParcelBoxAssignedPayload {
  parcel_id:   string;
  box_id:      string;
  office_id:   string;
  assigned_by: string;
  assigned_at: string;
}

export interface ParcelBoxSealedPayload {
  box_id:     string;
  office_id:  string;
  worker_id:  string;
  parcel_ids: string[];
  sealed_at:  string;
  qr_token:   string;
}

export interface ParcelBoxHandedToCourierPayload {
  box_id:       string;
  office_id:    string;
  courier_name: string;
  rider_id?:    string;
  handed_at:    string;
  route_code:   string;
}

export interface ParcelInIntercityTransitPayload {
  box_id:        string;
  parcel_ids:    string[];
  origin_office: string;
  dest_office:   string;
  departed_at:   string;
  est_arrival:   string;
}

export interface ParcelBoxArrivedGeofencePayload {
  box_id:     string;
  office_id:  string;
  lat:        number;
  lng:        number;
  arrived_at: string;
}

// ── DELIVERY ────────────────────────────────────────────────────

export interface ParcelLastMileRiderArrivedPayload {
  parcel_id:  string;
  rider_id:   string;
  lat:        number;
  lng:        number;
  arrived_at: string;
}

export interface ParcelDeliveryAttemptedPayload {
  parcel_id:    string;
  rider_id:     string;
  attempt:      number;
  reason:       string;
  attempted_at: string;
  lat:          number;
  lng:          number;
}

export interface ParcelDeliveryConfirmedPayload {
  parcel_id:         string;
  rider_id:          string;
  token_id:          string;
  delivered_at:      string;
  proof_photo_url?:  string;
  receiver_name?:    string;
  lat:               number;
  lng:               number;
}

export interface ParcelDeliveryFailedPayload {
  parcel_id: string;
  rider_id:  string;
  reason:    string;
  attempt:   number;
  failed_at: string;
}

// ── RETURNS ─────────────────────────────────────────────────────

export interface ParcelReturnPayload {
  parcel_id:    string;
  return_type:  'delivery_failure' | 'rejected_at_office';
  reason:       string;
  initiated_by: string;
  initiated_at: string;
}

// ── ROUTE & TOKENS ──────────────────────────────────────────────

export interface RouteSwitchPayload {
  parcel_id:      string;
  old_route_code: string;
  new_route_code: string;
  reason:         string;
  requested_by:   string;
  requested_at:   string;
}

export interface TokenPayload {
  token_id:   string;
  parcel_id:  string;
  token_type: 'pickup' | 'delivery' | 'box_seal' | 'box_receipt' | 'last_mile';
  actor_id:   string;
  action_at:  string;
}

// ── BOX ─────────────────────────────────────────────────────────

export interface BoxCreatedPayload {
  box_id:     string;
  office_id:  string;
  created_by: string;
  created_at: string;
  has_gps:    boolean;
}

export interface BoxAssignedToParcelPayload {
  box_id:      string;
  parcel_id:   string;
  office_id:   string;
  assigned_by: string;
  assigned_at: string;
}

export interface BoxSealedPayload {
  box_id:     string;
  office_id:  string;
  sealed_by:  string;
  parcel_ids: string[];
  sealed_at:  string;
  qr_token:   string;
}

export interface BoxDispatchedPayload {
  box_id:        string;
  office_id:     string;
  courier_name:  string;
  rider_id?:     string;
  dispatched_at: string;
}

export interface BoxGpsPingPayload {
  box_id:    string;
  lat:       number;
  lng:       number;
  speed?:    number;
  battery?:  number;
  timestamp: string;
}

export interface BoxGeofencePayload {
  box_id:      string;
  office_id:   string;
  lat:         number;
  lng:         number;
  occurred_at: string;
}

export interface BoxUnpackedPayload {
  box_id:      string;
  office_id:   string;
  unpacked_by: string;
  parcel_ids:  string[];
  unpacked_at: string;
}

export interface BoxAbnormalityPayload {
  box_id:      string;
  type:        'tamper' | 'drop' | 'temperature' | 'missing';
  description: string;
  reported_by: string;
  reported_at: string;
}

export interface BoxStatusPayload {
  box_id:      string;
  reason:      string;
  actioned_by: string;
  actioned_at: string;
}

// ── RIDER ───────────────────────────────────────────────────────

export interface RiderLocationPayload {
  rider_id:   string;
  lat:        number;
  lng:        number;
  heading?:   number;
  speed?:     number;
  job_id?:    string;
  parcel_id?: string;
  timestamp:  string;
}

export interface RiderJobPayload {
  rider_id:    string;
  job_id:      string;
  parcel_id:   string;
  stage:       'pickup' | 'last_mile' | 'intercity';
  occurred_at: string;
}

export interface RiderJobStartedPayload {
  rider_id:   string;
  job_id:     string;
  parcel_id:  string;
  started_at: string;
  lat:        number;
  lng:        number;
}

export interface RiderJobCancelledPayload {
  rider_id:     string;
  job_id:       string;
  parcel_id:    string;
  reason:       string;
  cancelled_at: string;
}

export interface RiderStatusPayload {
  rider_id:    string;
  occurred_at: string;
  lat?:        number;
  lng?:        number;
}

// ── OFFICE ──────────────────────────────────────────────────────

export interface OfficeCreatedPayload {
  office_id:  string;
  name:       string;
  address:    string;
  lat:        number;
  lng:        number;
  manager_id: string;
  created_by: string;
  created_at: string;
}

export interface OfficeConfigUpdatedPayload {
  office_id:  string;
  updated_by: string;
  changes:    Record<string, any>;
  updated_at: string;
}

export interface OfficeCapabilityToggledPayload {
  office_id:  string;
  capability: string;
  enabled:    boolean;
  toggled_by: string;
  toggled_at: string;
}

export interface OfficeSuspendedPayload {
  office_id:    string;
  reason:       string;
  suspended_by: string;
  suspended_at: string;
}

// ── USERS ───────────────────────────────────────────────────────

export interface UserRegisteredPayload {
  user_id:       string;
  phone:         string;
  role:          string;
  registered_at: string;
}

export interface UserVerifiedPayload {
  user_id:     string;
  phone:       string;
  verified_at: string;
}

export interface UserProfileUpdatedPayload {
  user_id:    string;
  changes:    Record<string, any>;
  updated_at: string;
}

export interface AgentApprovedPayload {
  agent_id:    string;
  approved_by: string;
  approved_at: string;
}

export interface AgentSuspendedPayload {
  agent_id:     string;
  reason:       string;
  suspended_by: string;
  suspended_at: string;
}

export interface RiderCreatedPayload {
  rider_id:     string;
  user_id:      string;
  office_id:    string;
  created_by:   string;
  vehicle_type: string;
  created_at:   string;
}

// ── ML ──────────────────────────────────────────────────────────

export interface MlAlertPayload {
  alert_id:   string;
  type:       string;
  entity_id:  string;
  score:      number;
  details:    Record<string, any>;
  created_at: string;
}

export interface MlRouteRecommendationResponsePayload {
  recommendation_id: string;
  parcel_id:         string;
  actioned_by:       string;
  actioned_at:       string;
  reason?:           string;
}

export interface MlEtaComputedPayload {
  parcel_id:   string;
  eta_minutes: number;
  confidence:  number;
  computed_at: string;
}

export interface MlFraudScorePayload {
  entity_id:   string;
  entity_type: 'user' | 'rider' | 'agent' | 'parcel';
  score:       number;
  risk_level:  'low' | 'medium' | 'high';
  computed_at: string;
}

// ── PAYMENT ─────────────────────────────────────────────────────

export interface PaymentDepositPayload {
  payment_id:   string;
  parcel_id:    string;
  user_id:      string;
  amount:       number;
  method:       'mpesa' | 'airtel_money' | 'cash' | 'card';
  phone?:       string;
  initiated_at: string;
}

export interface PaymentDepositConfirmedPayload {
  payment_id:   string;
  parcel_id:    string;
  amount:       number;
  method:       string;
  reference:    string;
  confirmed_at: string;
}

export interface PaymentDepositFailedPayload {
  payment_id: string;
  parcel_id:  string;
  amount:     number;
  reason:     string;
  failed_at:  string;
}

export interface AgentCommissionPayload {
  agent_id:    string;
  parcel_id:   string;
  amount:      number;
  credited_at: string;
}

export interface RiderEarningPayload {
  rider_id:    string;
  job_id:      string;
  parcel_id:   string;
  amount:      number;
  credited_at: string;
}

// ── NOTIFICATION ────────────────────────────────────────────────

export interface NotificationSentPayload {
  notification_id: string;
  user_id:         string;
  channel:         'sms' | 'push' | 'whatsapp';
  type:            string;
  sent_at:         string;
}

export interface NotificationFailedPayload {
  notification_id: string;
  user_id:         string;
  channel:         'sms' | 'push' | 'whatsapp';
  reason:          string;
  failed_at:       string;
}

// ================================================================
// EVENT PAYLOAD MAP — THE CONTRACT
// TypeScript will NOT compile if you publish an event
// with the wrong payload shape.
// ================================================================

export interface EventPayloadMap {
  'parcel.created':                               ParcelCreatedPayload;
  'parcel.route_assigned':                        ParcelRouteAssignedPayload;
  'parcel.rider_assigned':                        ParcelRiderAssignedPayload;
  'parcel.rider_dispatched':                      ParcelRiderDispatchedPayload;
  'parcel.rider_arrived_at_sender':               ParcelRiderArrivedAtSenderPayload;
  'parcel.collected_by_rider':                    ParcelCollectedByRiderPayload;
  'parcel.sender_self_dropoff':                   ParcelOfficeReceivedPayload;
  'parcel.agent_dropoff':                         ParcelOfficeReceivedPayload;
  'parcel.office_received':                       ParcelOfficeReceivedPayload;
  'parcel.measurement_declared':                  ParcelMeasurementPayload;
  'parcel.measurement_confirmed':                 ParcelMeasurementPayload;
  'parcel.measurement_mismatch_flagged':          ParcelMeasurementMismatchPayload;
  'parcel.packing_instruction_generated':         ParcelPackingInstructionPayload;
  'parcel.office_rider_assigned_to_courier':      ParcelOfficeRiderAssignedToCourierPayload;
  'parcel.repricing_triggered':                   ParcelRepricingPayload;
  'parcel.repricing_accepted':                    ParcelRepricingResponsePayload;
  'parcel.repricing_rejected':                    ParcelRepricingResponsePayload;
  'parcel.box_assigned':                          ParcelBoxAssignedPayload;
  'parcel.packed_into_box':                       ParcelBoxAssignedPayload;
  'parcel.box_sealed':                            ParcelBoxSealedPayload;
  'parcel.box_handed_to_courier':                 ParcelBoxHandedToCourierPayload;
  'parcel.in_intercity_transit':                  ParcelInIntercityTransitPayload;
  'parcel.box_arrived_geofence':                  ParcelBoxArrivedGeofencePayload;
  'parcel.box_received_at_dest_office':           ParcelOfficeReceivedPayload;
  'parcel.unpacked_from_box':                     ParcelOfficeReceivedPayload;
  'parcel.last_mile_rider_assigned':              ParcelRiderAssignedPayload;
  'parcel.last_mile_rider_dispatched':            ParcelRiderDispatchedPayload;
  'parcel.last_mile_rider_arrived_at_receiver':   ParcelLastMileRiderArrivedPayload;
  'parcel.delivery_attempted':                    ParcelDeliveryAttemptedPayload;
  'parcel.delivery_confirmed':                    ParcelDeliveryConfirmedPayload;
  'parcel.delivery_failed':                       ParcelDeliveryFailedPayload;
  'parcel.return_initiated.delivery_failure':     ParcelReturnPayload;
  'parcel.return_initiated.rejected_at_office':   ParcelReturnPayload;
  'parcel.return_collected':                      ParcelReturnPayload;
  'parcel.return_in_transit':                     ParcelReturnPayload;
  'parcel.return_arrived_origin':                 ParcelReturnPayload;
  'parcel.return_delivered_to_sender':            ParcelReturnPayload;
  'route.switch_requested':                       RouteSwitchPayload;
  'route.switch_approved':                        RouteSwitchPayload;
  'route.switch_executed':                        RouteSwitchPayload;
  'token.activated':                              TokenPayload;
  'token.consumed':                               TokenPayload;
  'token.discarded':                              TokenPayload;
  'token.expired':                                TokenPayload;
  'box.created':                                  BoxCreatedPayload;
  'box.assigned_to_parcel':                       BoxAssignedToParcelPayload;
  'box.sealed':                                   BoxSealedPayload;
  'box.dispatched_to_courier':                    BoxDispatchedPayload;
  'box.gps_ping':                                 BoxGpsPingPayload;
  'box.entered_office_geofence':                  BoxGeofencePayload;
  'box.exited_office_geofence':                   BoxGeofencePayload;
  'box.received_at_office':                       BoxGeofencePayload;
  'box.unpacked':                                 BoxUnpackedPayload;
  'box.abnormality_reported':                     BoxAbnormalityPayload;
  'box.missing_alert':                            BoxAbnormalityPayload;
  'box.suspended':                                BoxStatusPayload;
  'box.restored':                                 BoxStatusPayload;
  'box.retired':                                  BoxStatusPayload;
  'rider.location_updated':                       RiderLocationPayload;
  'rider.job_assigned':                           RiderJobPayload;
  'rider.job_accepted':                           RiderJobPayload;
  'rider.job_started':                            RiderJobStartedPayload;
  'rider.job_completed':                          RiderJobPayload;
  'rider.job_cancelled':                          RiderJobCancelledPayload;
  'rider.went_online':                            RiderStatusPayload;
  'rider.went_offline':                           RiderStatusPayload;
  'office.created':                               OfficeCreatedPayload;
  'office.config_updated':                        OfficeConfigUpdatedPayload;
  'office.capability_toggled':                    OfficeCapabilityToggledPayload;
  'office.suspended':                             OfficeSuspendedPayload;
  'user.registered':                              UserRegisteredPayload;
  'user.verified':                                UserVerifiedPayload;
  'user.profile_updated':                         UserProfileUpdatedPayload;
  'user.agent_approved':                          AgentApprovedPayload;
  'user.agent_suspended':                         AgentSuspendedPayload;
  'user.rider_created':                           RiderCreatedPayload;
  'user.rider_activated':                         RiderCreatedPayload;
  'ml.alert_generated':                           MlAlertPayload;
  'ml.route_recommendation_created':              MlAlertPayload;
  'ml.route_recommendation_approved':             MlRouteRecommendationResponsePayload;
  'ml.route_recommendation_rejected':             MlRouteRecommendationResponsePayload;
  'ml.rider_score_computed':                      MlAlertPayload;
  'ml.eta_computed':                              MlEtaComputedPayload;
  'ml.fraud_score_computed':                      MlFraudScorePayload;
  'payment.deposit_initiated':                    PaymentDepositPayload;
  'payment.deposit_confirmed':                    PaymentDepositConfirmedPayload;
  'payment.deposit_failed':                       PaymentDepositFailedPayload;
  'payment.refund_initiated':                     PaymentDepositPayload;
  'payment.agent_commission_earned':              AgentCommissionPayload;
  'payment.rider_earning_credited':               RiderEarningPayload;
  'notification.sent':                            NotificationSentPayload;
  'notification.failed':                          NotificationFailedPayload;
  'notification.delivered':                       NotificationSentPayload;
}

// ─── TYPE-SAFE EVENT BUILDER ─────────────────────────────────────
// Use this in every service to publish events.
// TypeScript will error if payload doesn't match the event type.

export function buildEvent<T extends EventName>(
  event: T,
  payload: EventPayloadMap[T],
  service: string
): BaseEvent<T, EventPayloadMap[T]> {
  return {
    event,
    payload,
    timestamp: new Date().toISOString(),
    service,
    version: '1.0',
  };
}

// ─── USAGE ───────────────────────────────────────────────────────
// import { buildEvent, EVENTS } from '@flexbox/events';
//
// const event = buildEvent(EVENTS.PARCEL_CREATED, {
//   parcel_id: '123',
//   tracking_code: 'FBX-2026-000001',
//   ...
// }, 'parcel-service');
