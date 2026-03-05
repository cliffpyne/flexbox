import { redis } from './redis';
import { db } from './db';

// ================================================================
// STATUS MAP — event type → parcel status
// ================================================================
const EVENT_TO_STATUS: Record<string, string> = {
  PARCEL_CREATED:                      'CREATED',
  PARCEL_RIDER_ASSIGNED:               'RIDER_ASSIGNED',
  PARCEL_RIDER_DISPATCHED:             'RIDER_ASSIGNED',
  PARCEL_RIDER_ARRIVED_AT_SENDER:      'AWAITING_COLLECTION',
  PARCEL_COLLECTED_BY_RIDER:           'COLLECTED',
  PARCEL_SENDER_SELF_DROPOFF:          'AT_ORIGIN_OFFICE',
  PARCEL_AGENT_DROPOFF:                'AT_ORIGIN_OFFICE',
  PARCEL_OFFICE_RECEIVED:              'AT_ORIGIN_OFFICE',
  PARCEL_MEASUREMENT_CONFIRMED:        'AT_ORIGIN_OFFICE',
  PARCEL_MEASUREMENT_MISMATCH_FLAGGED: 'MEASURING',
  PARCEL_REPRICING_TRIGGERED:          'AWAITING_PAYMENT',
  PARCEL_REPRICING_ACCEPTED:           'AT_ORIGIN_OFFICE',
  PARCEL_REPRICING_REJECTED:           'RETURN_INITIATED',
  PARCEL_BOX_ASSIGNED:                 'PACKING',
  PARCEL_PACKED_INTO_BOX:              'PACKING',
  PARCEL_BOX_SEALED:                   'PACKED',
  PARCEL_BOX_HANDED_TO_COURIER:        'IN_TRANSIT',
  PARCEL_IN_INTERCITY_TRANSIT:         'IN_TRANSIT',
  PARCEL_BOX_ARRIVED_GEOFENCE:         'IN_TRANSIT',
  PARCEL_BOX_RECEIVED_AT_DEST_OFFICE:  'AT_DEST_OFFICE',
  PARCEL_UNPACKED_FROM_BOX:            'AT_DEST_OFFICE',
  PARCEL_LAST_MILE_RIDER_ASSIGNED:     'AT_DEST_OFFICE',
  PARCEL_LAST_MILE_RIDER_DISPATCHED:   'OUT_FOR_DELIVERY',
  PARCEL_LAST_MILE_ARRIVED_AT_RECEIVER:'OUT_FOR_DELIVERY',
  PARCEL_DELIVERY_ATTEMPTED:           'DELIVERY_ATTEMPTED',
  PARCEL_DELIVERY_CONFIRMED:           'DELIVERED',
  PARCEL_DELIVERY_FAILED:              'DELIVERY_FAILED',
  PARCEL_RETURN_INITIATED:             'RETURN_INITIATED',
  PARCEL_RETURN_IN_TRANSIT:            'RETURN_IN_TRANSIT',
  PARCEL_RETURN_DELIVERED_TO_SENDER:   'RETURN_DELIVERED',
};

// ================================================================
// LEVEL MAP — event type → custody level
// ================================================================
const EVENT_TO_LEVEL: Record<string, string> = {
  PARCEL_COLLECTED_BY_RIDER:           'L1',
  PARCEL_SENDER_SELF_DROPOFF:          'L2',
  PARCEL_AGENT_DROPOFF:                'L2',
  PARCEL_OFFICE_RECEIVED:              'L2',
  PARCEL_BOX_HANDED_TO_COURIER:        'L3',
  PARCEL_BOX_RECEIVED_AT_DEST_OFFICE:  'L4',
  PARCEL_LAST_MILE_RIDER_DISPATCHED:   'L5',
  PARCEL_DELIVERY_CONFIRMED:           'L6',
};

// ================================================================
// LOCATION SOURCE MAP — event type → location source
// ================================================================
const EVENT_TO_LOCATION_SOURCE: Record<string, string> = {
  PARCEL_CREATED:                      'STATIC_SENDER',
  PARCEL_RIDER_ASSIGNED:               'STATIC_SENDER',
  PARCEL_COLLECTED_BY_RIDER:           'RIDER_PHONE',
  PARCEL_SENDER_SELF_DROPOFF:          'STATIC_OFFICE',
  PARCEL_AGENT_DROPOFF:                'STATIC_OFFICE',
  PARCEL_OFFICE_RECEIVED:              'STATIC_OFFICE',
  PARCEL_BOX_HANDED_TO_COURIER:        'HARDWARE_GPS',
  PARCEL_BOX_RECEIVED_AT_DEST_OFFICE:  'STATIC_OFFICE',
  PARCEL_LAST_MILE_RIDER_DISPATCHED:   'RIDER_PHONE',
  PARCEL_DELIVERY_CONFIRMED:           'STATIC_RECEIVER',
};

function emptyProjection(parcelId: string) {
  return {
    parcel_id:                  parcelId,
    status:                     'CREATED',
    current_level:              'L0',
    current_location:           null,
    active_rider_id:            null,
    active_box_id:              null,
    current_office_id:          null,
    origin_office_id:           null,
    dest_office_id:             null,
    route_code:                 null,
    universe:                   null,
    estimated_delivery:         null,
    repricing_deadline:         null,
    attempt_count:              0,
    last_event_type:            null,
    last_event_at:              null,
    event_count:                0,
  };
}

// ================================================================
// APPLY EVENT — incremental projection update
// ================================================================
function applyEvent(projection: any, event: any): any {
  const updated = { ...projection };

  // Always update these
  updated.last_event_type = event.event_type;
  updated.last_event_at   = event.occurred_at;
  updated.event_count     = (updated.event_count || 0) + 1;

  // Status update
  if (EVENT_TO_STATUS[event.event_type]) {
    updated.status = EVENT_TO_STATUS[event.event_type];
  }

  // Level update
  if (EVENT_TO_LEVEL[event.event_type]) {
    updated.current_level = EVENT_TO_LEVEL[event.event_type];
  }

  // Location source update
  if (EVENT_TO_LOCATION_SOURCE[event.event_type]) {
    updated.current_location = {
      ...updated.current_location,
      source:       EVENT_TO_LOCATION_SOURCE[event.event_type],
      lat:          event.gps_lat || updated.current_location?.lat,
      lng:          event.gps_lng || updated.current_location?.lng,
      last_updated: event.occurred_at,
      is_stale:     false,
    };
  }

  // Event-specific updates
  const p = event.payload || {};

  switch (event.event_type) {
    case 'PARCEL_CREATED':
      updated.route_code        = p.route_code;
      updated.universe          = p.universe;
      updated.origin_office_id  = p.origin_office_id;
      updated.dest_office_id    = p.dest_office_id;
      updated.current_office_id = p.origin_office_id;
      break;

    case 'PARCEL_RIDER_ASSIGNED':
    case 'PARCEL_LAST_MILE_RIDER_ASSIGNED':
      updated.active_rider_id      = p.rider_id;
      updated.estimated_delivery   = p.estimated_delivery || null;
      break;

    case 'PARCEL_RIDER_DISPATCHED':
    case 'PARCEL_LAST_MILE_RIDER_DISPATCHED':
      updated.current_location = {
        ...updated.current_location,
        source:   'RIDER_PHONE',
        is_moving: true,
      };
      break;

    case 'PARCEL_DELIVERY_CONFIRMED':
      updated.active_rider_id = null;
      updated.active_box_id   = null;
      break;

    case 'PARCEL_BOX_ASSIGNED':
      updated.active_box_id = p.box_id;
      break;

    case 'PARCEL_UNPACKED_FROM_BOX':
      updated.active_box_id     = null;
      updated.current_office_id = updated.dest_office_id;
      break;

    case 'PARCEL_BOX_RECEIVED_AT_DEST_OFFICE':
      updated.current_office_id = updated.dest_office_id;
      break;

    case 'PARCEL_REPRICING_TRIGGERED':
      updated.repricing_deadline = p.payment_deadline;
      break;

    case 'PARCEL_REPRICING_ACCEPTED':
    case 'PARCEL_REPRICING_REJECTED':
      updated.repricing_deadline = null;
      break;

    case 'PARCEL_DELIVERY_ATTEMPTED':
      updated.attempt_count = (updated.attempt_count || 0) + 1;
      break;

    case 'ROUTE_SWITCH_EXECUTED':
      updated.route_code = p.new_route_code;
      break;
  }

  return updated;
}

// ================================================================
// BUILD TRACKING VIEW — stripped public version
// ================================================================
function buildTrackingView(projection: any, parcel: any): any {
  const statusLabels: Record<string, string> = {
    CREATED:           'Booking confirmed',
    RIDER_ASSIGNED:    'Rider assigned',
    AWAITING_COLLECTION: 'Rider on the way',
    COLLECTED:         'Parcel collected',
    AT_ORIGIN_OFFICE:  'At origin office',
    MEASURING:         'Being measured',
    AWAITING_PAYMENT:  'Payment required',
    PACKING:           'Being packed',
    PACKED:            'Ready for dispatch',
    IN_TRANSIT:        'In transit',
    AT_DEST_OFFICE:    'Arrived at destination',
    OUT_FOR_DELIVERY:  'Out for delivery',
    DELIVERY_ATTEMPTED:'Delivery attempted',
    DELIVERED:         'Delivered',
    DELIVERY_FAILED:   'Delivery failed',
    RETURN_INITIATED:  'Return initiated',
    RETURN_IN_TRANSIT: 'Return in transit',
    RETURN_DELIVERED:  'Returned to sender',
  };

  return {
    parcel_id:         projection.parcel_id,
    booking_reference: parcel?.booking_reference,
    status:            projection.status,
    status_label:      statusLabels[projection.status] || projection.status,
    current_location:  projection.current_location,
    estimated_delivery: projection.estimated_delivery,
    last_updated:      projection.last_event_at,
  };
}

// ================================================================
// REBUILD PROJECTION — called on every parcel event
// Incremental — loads current from Redis, applies event, writes back
// ================================================================
export async function rebuildProjection(event: any, parcel?: any): Promise<any> {
  const parcelId = event.parcel_id;

  // 1. Load current projection from Redis (incremental — NOT full replay)
  const cached = await redis.get(`parcel:${parcelId}:projection`);
  const current = cached ? JSON.parse(cached) : emptyProjection(parcelId);

  // 2. Apply the single new event
  const updated = applyEvent(current, event);

  // 3. Build public tracking view
  const trackingView = buildTrackingView(updated, parcel);

  // 4. Write both to Redis atomically
  const multi = redis.multi();
  multi.set(`parcel:${parcelId}:projection`, JSON.stringify(updated));
  multi.set(`parcel:${parcelId}:tracking`,   JSON.stringify(trackingView));
  await multi.exec();

  // 5. Publish to Redis pub/sub — WebSocket gateway pushes to clients
  await redis.publish(`parcel:${parcelId}:tracking`, JSON.stringify(trackingView));

  // 6. Mark SLA completed if relevant level done
  const levelCompleted = EVENT_TO_LEVEL[event.event_type];
  if (levelCompleted) {
    await redis.set(`sla_completed:${parcelId}:${levelCompleted}`, 'DONE', { EX: 86400 });
  }

  return updated;
}