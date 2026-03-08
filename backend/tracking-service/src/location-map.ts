// Event → Location Source mapping
export const LOCATION_SOURCE_MAP: Record<string, { source: string; label: string }> = {
  PARCEL_CREATED:                    { source: 'STATIC_SENDER',   label: 'Waiting at sender address' },
  PARCEL_RIDER_ASSIGNED:             { source: 'STATIC_SENDER',   label: 'Waiting for rider — parcel at sender location' },
  PARCEL_RIDER_DISPATCHED:           { source: 'RIDER_PHONE',     label: 'Rider en route to sender' },
  PARCEL_RIDER_ARRIVED_AT_SENDER:    { source: 'RIDER_PHONE',     label: 'Rider at sender address' },
  PARCEL_COLLECTED_BY_RIDER:         { source: 'RIDER_PHONE',     label: 'With rider — heading to office' },
  PARCEL_SENDER_SELF_DROPOFF:        { source: 'STATIC_OFFICE',   label: 'At origin office' },
  PARCEL_AGENT_DROPOFF:              { source: 'STATIC_OFFICE',   label: 'At origin office (agent dropped off)' },
  PARCEL_OFFICE_RECEIVED:            { source: 'STATIC_OFFICE',   label: 'At origin office — being processed' },
  PARCEL_BOX_SEALED:                 { source: 'STATIC_OFFICE',   label: 'At origin office — ready for dispatch' },
  PARCEL_BOX_HANDED_TO_COURIER:      { source: 'HARDWARE_GPS',    label: 'In transit — GPS box tracking' },
  PARCEL_IN_INTERCITY_TRANSIT:       { source: 'HARDWARE_GPS',    label: 'Intercity transit — GPS tracking' },
  PARCEL_BOX_ARRIVED_GEOFENCE:       { source: 'HARDWARE_GPS',    label: 'Approaching destination city' },
  PARCEL_BOX_RECEIVED_AT_DEST_OFFICE:{ source: 'STATIC_OFFICE',   label: 'At destination office' },
  PARCEL_UNPACKED_FROM_BOX:          { source: 'STATIC_OFFICE',   label: 'At destination office — unpacked' },
  PARCEL_LAST_MILE_RIDER_ASSIGNED:   { source: 'STATIC_OFFICE',   label: 'At destination office — rider assigned' },
  PARCEL_LAST_MILE_RIDER_DISPATCHED: { source: 'RIDER_PHONE',     label: 'Out for delivery — with rider' },
  PARCEL_LAST_MILE_ARRIVED_AT_RECEIVER:{ source: 'RIDER_PHONE',   label: 'Rider at receiver address' },
  PARCEL_DELIVERY_CONFIRMED:         { source: 'STATIC_RECEIVER', label: 'Delivered' },
  PARCEL_DELIVERY_FAILED:            { source: 'RIDER_PHONE',     label: 'Delivery failed — rider returning' },
  PARCEL_RETURN_INITIATED:           { source: 'STATIC_OFFICE',   label: 'Return initiated — at dest office' },
};

export const STATIC_SOURCES = ['STATIC_OFFICE', 'STATIC_SENDER', 'STATIC_RECEIVER'];

export function computeIsStale(lastUpdated: string): boolean {
  return Date.now() - new Date(lastUpdated).getTime() > 5 * 60 * 1000;
}