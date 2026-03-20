import { UserRole } from '@flexbox/types';

// ================================================================
// ROUTE ACTIVE LEVELS
// Which custody levels are active for each route code
// ================================================================
export const ROUTE_ACTIVE_LEVELS: Record<string, string[]> = {
  // UPCOUNTRY
  'A1-B1-C1-D1': ['L1','L2','L3','L4','L5','L6'],
  'A1-B1-C1-D2': ['L1','L2','L3','L4','L6'],
  'A1-B1-C2-D1': ['L1','L2','L3','L4','L5','L6'],
  'A1-B1-C2-D2': ['L1','L2','L3','L4','L6'],
  'A1-B2-C1-D1': ['L1','L2','L3','L4','L5','L6'],
  'A1-B2-C1-D2': ['L1','L2','L3','L4','L6'],
  'A1-B2-C2-D1': ['L1','L2','L3','L4','L5','L6'],
  'A1-B2-C2-D2': ['L1','L2','L3','L4','L6'],
  'A2-B1-C1-D1': ['L2','L3','L4','L5','L6'],
  'A2-B1-C1-D2': ['L2','L3','L4','L6'],
  'A2-B1-C2-D1': ['L2','L3','L4','L5','L6'],
  'A2-B1-C2-D2': ['L2','L3','L4','L6'],
  'A2-B2-C1-D1': ['L2','L3','L4','L5','L6'],
  'A2-B2-C1-D2': ['L2','L3','L4','L6'],
  'A2-B2-C2-D1': ['L2','L3','L4','L5','L6'],
  'A2-B2-C2-D2': ['L2','L3','L4','L6'],
  'A3-B1-C1-D1': ['L2','L3','L4','L5','L6'],
  'A3-B1-C1-D2': ['L2','L3','L4','L6'],
  'A3-B1-C2-D1': ['L2','L3','L4','L5','L6'],
  'A3-B1-C2-D2': ['L2','L3','L4','L6'],
  'A3-B2-C1-D1': ['L2','L3','L4','L5','L6'],
  'A3-B2-C1-D2': ['L2','L3','L4','L6'],
  'A3-B2-C2-D1': ['L2','L3','L4','L5','L6'],
  'A3-B2-C2-D2': ['L2','L3','L4','L6'],
  // IN-REGION
  'A1-B0-C0-D1':  ['L1','L6'],
  'A1-BIR-C0-D1': ['L1','L2','L5','L6'],
  'A1-BIR-C0-D2': ['L1','L2','L6'],
  'A2-BIR-C0-D1': ['L2','L5','L6'],
  'A2-BIR-C0-D2': ['L2','L6'],
  'A3-B0-C0-D1':  ['L6'],
  'A1-BSP-C0-D1': ['L1','L2','L5','L6'],
  'A2-BSP-C0-D1': ['L2','L5','L6'],
};

// ================================================================
// FLOW STATE MACHINE
// Given last event — what events are valid next + who can fire them
// ================================================================
interface NextEventRule {
  events:     string[];
  actors:     string[];
  note?:      string;
}

export const FLOW_STATE_MACHINE: Record<string, NextEventRule> = {
  // A1 routes — pickup rider
  'PARCEL_CREATED_A1': {
    events: ['PARCEL_RIDER_ASSIGNED'],
    actors: ['SYSTEM', UserRole.OFFICE_MANAGER, UserRole.OPS_ADMIN],
  },
  // A2/A3 routes — self drop or agent
  'PARCEL_CREATED_A2': {
    events: ['PARCEL_SENDER_SELF_DROPOFF'],
    actors: [UserRole.CUSTOMER, UserRole.OFFICE_WORKER, UserRole.OFFICE_MANAGER],
  },
  'PARCEL_CREATED_A3': {
    events: ['PARCEL_AGENT_DROPOFF'],
    actors: [UserRole.AGENT, UserRole.OFFICE_WORKER, UserRole.OFFICE_MANAGER],
  },
  'OFFICER_ASSIGNED': {
    events: ['PARCEL_RIDER_ASSIGNED'],
    actors: ['SYSTEM', 'OPS_ADMIN', 'SUPER_ADMIN', 'OFFICE_MANAGER'],
  },
  'PARCEL_RIDER_ASSIGNED': {
    events: ['PARCEL_RIDER_DISPATCHED'],
    actors: ['SYSTEM'],
  },
  'PARCEL_RIDER_DISPATCHED': {
    events: ['PARCEL_RIDER_ARRIVED_AT_SENDER'],
    actors: [UserRole.RIDER, 'SYSTEM'],
  },
  'PARCEL_RIDER_ARRIVED_AT_SENDER': {
    events: ['PARCEL_COLLECTED_BY_RIDER'],
    actors: [UserRole.RIDER],
  },
  'PARCEL_COLLECTED_BY_RIDER': {
    events: ['PARCEL_OFFICE_RECEIVED'],
    actors: [UserRole.OFFICE_WORKER, UserRole.OFFICE_MANAGER],
  },
  'PARCEL_SENDER_SELF_DROPOFF': {
    events: ['PARCEL_OFFICE_RECEIVED'],
    actors: [UserRole.OFFICE_WORKER, UserRole.OFFICE_MANAGER],
  },
  'PARCEL_AGENT_DROPOFF': {
    events: ['PARCEL_OFFICE_RECEIVED'],
    actors: [UserRole.OFFICE_WORKER, UserRole.OFFICE_MANAGER],
  },
  'PARCEL_OFFICE_RECEIVED': {
    events: ['PARCEL_MEASUREMENT_CONFIRMED', 'PARCEL_MEASUREMENT_MISMATCH_FLAGGED'],
    actors: [UserRole.OFFICE_WORKER, UserRole.OFFICE_MANAGER],
  },
  'PARCEL_MEASUREMENT_CONFIRMED': {
    events: ['PARCEL_BOX_ASSIGNED'],
    actors: ['SYSTEM', UserRole.OFFICE_WORKER, UserRole.OFFICE_MANAGER],
  },
  'PARCEL_REPRICING_TRIGGERED': {
    events: ['PARCEL_REPRICING_ACCEPTED', 'PARCEL_REPRICING_REJECTED'],
    actors: [UserRole.CUSTOMER, 'SYSTEM'],
  },
  'PARCEL_REPRICING_ACCEPTED': {
    events: ['PARCEL_BOX_ASSIGNED'],
    actors: ['SYSTEM', UserRole.OFFICE_WORKER],
  },
  'PARCEL_REPRICING_REJECTED': {
    events: ['PARCEL_RETURN_INITIATED'],
    actors: ['SYSTEM', UserRole.OFFICE_MANAGER],
  },
  'PARCEL_BOX_ASSIGNED': {
    events: ['PARCEL_PACKED_INTO_BOX'],
    actors: [UserRole.OFFICE_WORKER, UserRole.OFFICE_MANAGER],
  },
  'PARCEL_PACKED_INTO_BOX': {
    events: ['PARCEL_BOX_SEALED', 'PARCEL_PACKED_INTO_BOX'],
    actors: [UserRole.OFFICE_WORKER, UserRole.OFFICE_MANAGER],
  },
  'PARCEL_BOX_SEALED': {
    events: ['PARCEL_BOX_HANDED_TO_COURIER'],
    actors: [UserRole.OFFICE_WORKER, UserRole.OFFICE_MANAGER, UserRole.RIDER],
  },
  'PARCEL_BOX_HANDED_TO_COURIER': {
    events: ['PARCEL_IN_INTERCITY_TRANSIT', 'PARCEL_BOX_GPS_PING'],
    actors: ['SYSTEM', 'GPS_DEVICE'],
  },
  'PARCEL_IN_INTERCITY_TRANSIT': {
    events: ['PARCEL_BOX_GPS_PING', 'PARCEL_BOX_ARRIVED_GEOFENCE'],
    actors: ['SYSTEM', 'GPS_DEVICE'],
  },
  'PARCEL_BOX_ARRIVED_GEOFENCE': {
    events: ['PARCEL_BOX_RECEIVED_AT_DEST_OFFICE'],
    actors: [UserRole.OFFICE_WORKER, UserRole.OFFICE_MANAGER],
  },
  'PARCEL_BOX_RECEIVED_AT_DEST_OFFICE': {
    events: ['PARCEL_UNPACKED_FROM_BOX'],
    actors: [UserRole.OFFICE_WORKER, UserRole.OFFICE_MANAGER],
  },
  'PARCEL_UNPACKED_FROM_BOX': {
    events: ['PARCEL_LAST_MILE_RIDER_ASSIGNED', 'PARCEL_READY_FOR_SELF_PICKUP'],
    actors: ['SYSTEM', UserRole.OFFICE_MANAGER],
  },
  'PARCEL_LAST_MILE_RIDER_ASSIGNED': {
    events: ['PARCEL_LAST_MILE_RIDER_DISPATCHED'],
    actors: ['SYSTEM'],
  },
  'PARCEL_LAST_MILE_RIDER_DISPATCHED': {
    events: ['PARCEL_LAST_MILE_ARRIVED_AT_RECEIVER'],
    actors: [UserRole.RIDER, 'SYSTEM'],
  },
  'PARCEL_LAST_MILE_ARRIVED_AT_RECEIVER': {
    events: ['PARCEL_DELIVERY_CONFIRMED', 'PARCEL_DELIVERY_ATTEMPTED'],
    actors: [UserRole.RIDER],
  },
  'PARCEL_DELIVERY_ATTEMPTED': {
    events: ['PARCEL_LAST_MILE_RIDER_DISPATCHED', 'PARCEL_DELIVERY_FAILED'],
    actors: [UserRole.RIDER, 'SYSTEM'],
  },
  'PARCEL_DELIVERY_FAILED': {
    events: ['PARCEL_RETURN_INITIATED'],
    actors: ['SYSTEM', UserRole.CUSTOMER, UserRole.OPS_ADMIN],
  },
};

// ================================================================
// SWITCH ELIGIBILITY
// Who can switch at each custody level
// ================================================================
export type SwitchPermission = 'FULL' | 'DEST_ONLY' | 'LAST_MILE_ONLY' | 'NONE' | 'EMERGENCY_ONLY';

export function getSwitchEligibility(
  currentLevel: string,
  lastEventType: string,
  actorRole: string
): { eligible: boolean; allowed_changes: SwitchPermission; requires_approval: boolean } {
  const roleMap: Record<string, Record<string, SwitchPermission>> = {
    [UserRole.CUSTOMER]: {
      'L0':        'FULL',
      'CREATED':   'FULL',
      'RIDER_ASSIGNED': 'DEST_ONLY',
      default:     'NONE',
    },
    [UserRole.AGENT]: {
      'L0':        'FULL',
      'CREATED':   'FULL',
      'RIDER_ASSIGNED': 'DEST_ONLY',
      default:     'NONE',
    },
    [UserRole.OFFICE_MANAGER]: {
      'L0':        'FULL',
      'CREATED':   'FULL',
      'L1':        'FULL',
      'L2':        'LAST_MILE_ONLY',
      'L3':        'LAST_MILE_ONLY',
      'L4':        'LAST_MILE_ONLY',
      'L5':        'NONE',
      default:     'NONE',
    },
    [UserRole.OPS_ADMIN]: {
      'L0':        'FULL',
      'CREATED':   'FULL',
      'L1':        'FULL',
      'L2':        'FULL',
      'L3':        'FULL',
      'L4':        'FULL',
      'L5':        'EMERGENCY_ONLY',
      default:     'EMERGENCY_ONLY',
    },
    [UserRole.SUPER_ADMIN]: {
      default:     'FULL',
    },
  };

  const roleRules = roleMap[actorRole] || { default: 'NONE' };
  const key = currentLevel || 'L0';
  const allowed_changes: SwitchPermission = (roleRules[key] || roleRules['default'] || 'NONE') as SwitchPermission;
  const eligible = allowed_changes !== 'NONE';
  const requires_approval = [UserRole.OPS_ADMIN, UserRole.SUPER_ADMIN].includes(actorRole as UserRole);

  return { eligible, allowed_changes, requires_approval };
}
// ── Passthrough admin events (do not block flow) ──────────────────────────────
// These events are logged for audit but don't change the flow state
// The validate-event endpoint should treat them as transparent
