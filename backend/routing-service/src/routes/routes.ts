import { Router } from 'express';
import { z } from 'zod';
import { ROUTE_CODES } from '@flexbox/constants';
import { ROUTE_ACTIVE_LEVELS, FLOW_STATE_MACHINE, getSwitchEligibility } from '../state-machine';

const router = Router();

// ================================================================
// POST /routes/assign — Build route code from capabilities + preferences
// Called by Parcel Service at booking time
// ================================================================
router.post('/assign', async (req, res) => {
  try {
    const body = z.object({
      origin_office_id:    z.string().uuid(),
      dest_office_id:      z.string().uuid(),
      origin_capabilities: z.record(z.boolean()),
      dest_capabilities:   z.record(z.boolean()),
      origin_preference:   z.enum(['A1','A2','A3']),
      last_mile_preference:z.enum(['D1','D2']),
      universe:            z.enum(['UPCOUNTRY','IN_REGION']),
      is_fragile:          z.boolean().default(false),
      express:             z.boolean().default(false),
      special_protection:  z.boolean().default(false),
    }).parse(req.body);

    const { origin_capabilities: oc, dest_capabilities: dc } = body;

    // ── Build A segment ──────────────────────────────────────
    let A = '';
    if (body.origin_preference === 'A1' && oc.has_pickup_riders)   A = 'A1';
    else if (body.origin_preference === 'A2' && oc.accepts_self_dropoff) A = 'A2';
    else if (body.origin_preference === 'A3' && oc.has_active_agents) A = 'A3';
    else if (oc.accepts_self_dropoff) A = 'A2'; // fallback
    else return res.status(400).json({ success: false, message: 'PARCEL_002: Origin office cannot support requested pickup method' });

    // ── Build D segment ──────────────────────────────────────
    let D = '';
    if (body.last_mile_preference === 'D1' && dc.has_last_mile_delivery_riders) D = 'D1';
    else D = 'D2'; // D2 is always available

    // ── Build B + C segments based on universe ───────────────
    let route_code = '';
    let flow_template = '';

    if (body.universe === 'IN_REGION') {
      if (body.express && dc.supports_direct_single_rider && A === 'A1') {
        route_code = 'A1-B0-C0-D1';
        flow_template = 'IN_REGION_DIRECT';
      } else if (body.special_protection) {
        route_code = `${A}-BSP-C0-D1`;
        flow_template = 'IN_REGION_SPECIAL';
      } else {
        route_code = `${A}-BIR-C0-${D}`;
        flow_template = 'IN_REGION_OFFICE';
      }
    } else {
      // UPCOUNTRY — build B and C from capabilities
      let B = '';
      if (oc.has_office_to_courier_riders)        B = 'B1';
      else if (oc.office_staff_handle_courier_dropoff) B = 'B2';
      else B = 'B1'; // default

      let C = '';
      if (dc.has_courier_collection_riders)         C = 'C1';
      else if (dc.office_staff_collect_from_courier) C = 'C2';
      else C = 'C2'; // default

      route_code    = `${A}-${B}-${C}-${D}`;
      flow_template = 'UPCOUNTRY_FULL';
    }

    // ── Validate route code exists ───────────────────────────
    const normalizedCode = route_code.replace('C0-', '').replace('-C0', '');
    const isValid = ROUTE_ACTIVE_LEVELS[route_code] || ROUTE_ACTIVE_LEVELS[normalizedCode];

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: `PARCEL_002: Route code ${route_code} is not a valid combination`
      });
    }

    const active_levels = ROUTE_ACTIVE_LEVELS[route_code] || ROUTE_ACTIVE_LEVELS[normalizedCode];

    res.json({
      success: true,
      data: { route_code, active_levels, flow_template, universe: body.universe }
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ================================================================
// GET /routes/options?origin_office_id=&dest_office_id=
// All valid routes between two offices — for booking UI
// ================================================================
router.get('/options', async (req, res) => {
  try {
    const { origin_office_id, dest_office_id } = req.query as any;

    // In real implementation this would call Office Service for capabilities
    // For now return a representative set based on full capabilities
    const options = [
      {
        route_code:     'A1-B1-C1-D1',
        label:          'Door to Door',
        description:    'Rider collects from you. Delivered to receiver\'s door.',
        active_levels:  ['L1','L2','L3','L4','L5','L6'],
        origin_fee:     2000,
        last_mile_fee:  2500,
        total_fee_on_top: 4500,
        recommended:    true,
      },
      {
        route_code:     'A1-B1-C1-D2',
        label:          'Rider Pickup — Receiver Self-Pickup',
        description:    'Rider collects from you. Receiver picks up at destination office.',
        active_levels:  ['L1','L2','L3','L4','L6'],
        origin_fee:     2000,
        last_mile_fee:  0,
        total_fee_on_top: 2000,
        recommended:    false,
      },
      {
        route_code:     'A2-B1-C1-D1',
        label:          'I Drop Off — Delivered to Door',
        description:    'You bring parcel to our office. Delivered to receiver\'s door.',
        active_levels:  ['L2','L3','L4','L5','L6'],
        origin_fee:     0,
        last_mile_fee:  2500,
        total_fee_on_top: 2500,
        recommended:    false,
      },
      {
        route_code:     'A2-B1-C1-D2',
        label:          'Cheapest — Drop Off & Self Pickup',
        description:    'You drop off. Receiver picks up from destination office.',
        active_levels:  ['L2','L3','L4','L6'],
        origin_fee:     0,
        last_mile_fee:  0,
        total_fee_on_top: 0,
        recommended:    false,
      },
    ];

    res.json({ success: true, data: { origin_office_id, dest_office_id, options } });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ================================================================
// GET /routes/next-events?route_code=&current_level=&last_event_type=
// What events are valid next for this parcel?
// ================================================================
router.get('/next-events', async (req, res) => {
  try {
    const { route_code, current_level, last_event_type } = req.query as any;

    if (!last_event_type) {
      // First event — determine from route code A segment
      const A = route_code?.split('-')[0] || 'A1';
      const key = `PARCEL_CREATED_${A}`;
      const rule = FLOW_STATE_MACHINE[key];
      return res.json({ success: true, data: { valid_next_events: rule?.events || [], actors: rule?.actors || [] } });
    }

    const rule = FLOW_STATE_MACHINE[last_event_type];
    if (!rule) {
      return res.json({ success: true, data: { valid_next_events: [], actors: [], note: 'Terminal state or unknown event' } });
    }

    res.json({ success: true, data: { valid_next_events: rule.events, actors: rule.actors } });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ================================================================
// POST /routes/validate-event — Can this event fire right now?
// Called by Parcel Service BEFORE every single event append
// ================================================================
router.post('/validate-event', async (req, res) => {
  try {
    const body = z.object({
      route_code:      z.string(),
      current_level:   z.string().optional(),
      last_event_type: z.string().nullable().optional(),
      event_type:      z.string(),
      actor_role:      z.string(),
      actor_office_id: z.string().uuid().nullable().optional(),
    }).parse(req.body);

    // First event on parcel
    if (!body.last_event_type) {
      const A   = body.route_code.split('-')[0];
      const key = `PARCEL_CREATED_${A}`;
      const rule = FLOW_STATE_MACHINE[key];
      if (!rule) return res.json({ valid: true }); // Allow if no rule yet

      const eventAllowed = rule.events.includes(body.event_type);
      const actorAllowed = rule.actors.includes(body.actor_role) || rule.actors.includes('SYSTEM');

      if (!eventAllowed) return res.json({ valid: false, reason: 'WRONG_EVENT_FOR_CURRENT_STATE' });
      if (!actorAllowed) return res.json({ valid: false, reason: 'WRONG_ACTOR' });
      return res.json({ valid: true });
    }

    const rule = FLOW_STATE_MACHINE[body.last_event_type];

    // No rule = terminal state
    if (!rule) return res.json({ valid: false, reason: 'LEVEL_ALREADY_COMPLETE' });

    const eventAllowed = rule.events.includes(body.event_type);
    const actorAllowed = rule.actors.includes(body.actor_role) || rule.actors.includes('SYSTEM');

    if (!eventAllowed) return res.json({ valid: false, reason: 'WRONG_EVENT_FOR_CURRENT_STATE' });
    if (!actorAllowed) return res.json({ valid: false, reason: 'WRONG_ACTOR' });

    res.json({ valid: true });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ================================================================
// GET /routes/:parcel_id/switch-eligibility
// ================================================================
router.get('/:parcel_id/switch-eligibility', async (req: any, res) => {
  try {
    const actorRole    = req.query.actor_role as string;
    const currentLevel = req.query.current_level as string || 'L0';
    const lastEvent    = req.query.last_event_type as string || '';

    const result = getSwitchEligibility(currentLevel, lastEvent, actorRole);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ================================================================
// POST /routes/:parcel_id/switch — Execute route switch
// ================================================================
router.post('/:parcel_id/switch', async (req: any, res) => {
  try {
    const body = z.object({
      new_route_code: z.string(),
      reason_code:    z.string().min(3),
      reason_detail:  z.string().min(10),
      actor_role:     z.string(),
    }).parse(req.body);

    // Get current parcel from DB
    const { Pool } = await import('pg');
    const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

    const { rows: [parcel] } = await db.query(
      'SELECT * FROM parcels WHERE parcel_id=$1', [req.params.parcel_id]
    );
    if (!parcel) return res.status(404).json({ success: false, message: 'PARCEL_001: Not found' });

    // Get projection from Redis
    const { createClient } = await import('redis');
    const redis = createClient({ url: process.env.REDIS_URL });
    await redis.connect();
    const cached = await redis.get(`parcel:${parcel.parcel_id}:projection`);
    const projection = cached ? JSON.parse(cached) : null;
    const currentLevel = projection?.current_level || 'L0';

    // Eligibility check
    const eligibility = getSwitchEligibility(currentLevel, projection?.last_event_type || '', body.actor_role);
    if (!eligibility.eligible) {
      await redis.disconnect();
      await db.end();
      return res.status(403).json({
        success: false,
        message: `Route switch not allowed at current custody level`,
        allowed_changes: eligibility.allowed_changes,
      });
    }

    // Validate new route code
    if (!ROUTE_ACTIVE_LEVELS[body.new_route_code]) {
      await redis.disconnect();
      await db.end();
      return res.status(400).json({ success: false, message: 'PARCEL_002: Invalid new route code' });
    }

    const old_active = ROUTE_ACTIVE_LEVELS[parcel.route_code] || [];
    const new_active = ROUTE_ACTIVE_LEVELS[body.new_route_code];

    // Determine levels being removed
    const levels_removed = old_active.filter(l => !new_active.includes(l));
    const levels_added   = new_active.filter(l => !old_active.includes(l));

    // Execute switch in a transaction
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Update parcels row
      await client.query(
        'UPDATE parcels SET route_code=$1, updated_at=NOW() WHERE parcel_id=$2',
        [body.new_route_code, parcel.parcel_id]
      );

      // Discard tokens for removed levels
      const tokens_discarded: string[] = [];
      for (const level of levels_removed) {
        const { rows: tokens } = await client.query(
          `UPDATE custody_tokens SET state='DISCARDED', discarded_reason='ROUTE_SWITCH', updated_at=NOW()
           WHERE parcel_id=$1 AND custody_level=$2 AND state IN ('PENDING','ACTIVE')
           RETURNING token_id`,
          [parcel.parcel_id, level]
        );
        tokens.forEach(t => tokens_discarded.push(t.token_id));
      }

      // Append ROUTE_SWITCH_EXECUTED event
      await client.query(
        `INSERT INTO parcel_events
           (parcel_id,event_type,event_version,actor_type,actor_id,payload,occurred_at,recorded_at)
         VALUES ($1,'ROUTE_SWITCH_EXECUTED',1,$2,$3,$4,NOW(),NOW())`,
        [
          parcel.parcel_id,
          body.actor_role,
          req.actor?.user_id || 'system',
          JSON.stringify({
            old_route_code:  parcel.route_code,
            new_route_code:  body.new_route_code,
            reason_code:     body.reason_code,
            reason_detail:   body.reason_detail,
            levels_removed,
            levels_added,
            tokens_discarded,
          }),
        ]
      );

      // Audit log
      await client.query(
        `INSERT INTO audit_log (actor_id, actor_role, action, entity_type, entity_id, before_state, after_state)
         VALUES ($1,$2,'ROUTE_SWITCH','parcels',$3,$4,$5)`,
        [
          req.actor?.user_id || 'system', body.actor_role, parcel.parcel_id,
          JSON.stringify({ route_code: parcel.route_code }),
          JSON.stringify({ route_code: body.new_route_code, reason: body.reason_detail }),
        ]
      );

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    await redis.disconnect();
    await db.end();

    res.json({
      success: true,
      data: {
        old_route_code:  parcel.route_code,
        new_route_code:  body.new_route_code,
        levels_removed,
        levels_added,
      }
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

export default router;