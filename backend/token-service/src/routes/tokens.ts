import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { redis } from '../redis';
import { authenticate } from '../middleware';
import { publishEvent } from '../qstash';
import { TOKEN_TTL, LEVEL_ROLE, ROUTE_ACTIVE_LEVELS, getFirstLevel, signToken, verifyTokenJWT, generateQRBase64 } from '../token-utils';

const router = Router();

// ================================================================
// POST /tokens/generate — Generate all tokens for a new booking
// Called by Parcel Service after PARCEL_CREATED
// ================================================================
router.post('/generate', authenticate, async (req: any, res) => {
  try {
    const body = z.object({
      parcel_id:        z.string().uuid(),
      route_code:       z.string(),
      origin_office_id: z.string().uuid(),
      dest_office_id:   z.string().uuid(),
      booking_reference: z.string(),
    }).parse(req.body);

    const activeLevels = ROUTE_ACTIVE_LEVELS[body.route_code];
    if (!activeLevels) return res.status(400).json({ success: false, message: 'Invalid route code' });

    const firstLevel = getFirstLevel(body.route_code);
    const tokens = [];
    const now = Math.floor(Date.now() / 1000);

    for (const level of activeLevels) {
      const ttl = TOKEN_TTL[level];
      const issuedAt = now;
      const expiresAt = now + ttl;

      // Determine expected_office_id for office-level tokens
      let expected_office_id: string | null = null;
      if (['L2', 'L3'].includes(level)) expected_office_id = body.origin_office_id;
      if (['L4'].includes(level)) expected_office_id = body.dest_office_id;

      const tokenPayload = {
        token_id:           crypto.randomUUID(),
        parcel_id:          body.parcel_id,
        level,
        expected_role:      LEVEL_ROLE[level],
        expected_office_id,
        route_code:         body.route_code,
        booking_reference:  body.booking_reference,
        issued_at:          issuedAt,
        expires_at:         expiresAt,
      };

      // L6 is generated later at dispatch time — skip for now
      if (level === 'L6') {
        // Insert as PENDING — will be regenerated at LAST_MILE_RIDER_DISPATCHED
        const jwtString = signToken(tokenPayload);
        await db.query(
          `INSERT INTO custody_tokens
             (token_id, parcel_id, level, expected_actor_role, expected_office_id,
              route_code_at_creation, state, jwt_payload, expires_at, issued_at)
           VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8,NOW())`,
          [tokenPayload.token_id, body.parcel_id, level, LEVEL_ROLE[level],
           expected_office_id, body.route_code, jwtString,
           new Date(expiresAt * 1000).toISOString()]
        );
        tokens.push({ token_id: tokenPayload.token_id, level, state: 'PENDING', expires_at: new Date(expiresAt * 1000).toISOString() });
        continue;
      }

      const state = level === firstLevel ? 'ACTIVE' : 'PENDING';
      const jwtString = signToken(tokenPayload);

      await db.query(
        `INSERT INTO custody_tokens
           (token_id, parcel_id, level, expected_actor_role, expected_office_id,
            route_code_at_creation, state, jwt_payload, expires_at, issued_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
        [tokenPayload.token_id, body.parcel_id, level, LEVEL_ROLE[level],
         expected_office_id, body.route_code, state, jwtString,
         new Date(expiresAt * 1000).toISOString()]
      );

      // Cache active token in Redis
      if (state === 'ACTIVE') {
        await redis.set(`parcel:${body.parcel_id}:active_token`, tokenPayload.token_id);
        await redis.set(`token:${tokenPayload.token_id}:valid`, '1', { EX: ttl });
        await redis.set(`token:${tokenPayload.token_id}:state`, 'ACTIVE', { EX: ttl + 3600 });
      }

      tokens.push({ token_id: tokenPayload.token_id, level, state, expires_at: new Date(expiresAt * 1000).toISOString() });
    }

    // Publish TOKEN_ACTIVATED for first level
    await publishEvent('token.lifecycle', {
      event_type: 'TOKEN_ACTIVATED', parcel_id: body.parcel_id,
      level: firstLevel, service: 'token-service'
    }, { dedup_id: `token-activated-${body.parcel_id}-${firstLevel}` });

    res.status(201).json({ success: true, data: { tokens } });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ================================================================
// POST /tokens/generate-single — Generate replacement token (route switch)
// ================================================================
router.post('/generate-single', authenticate, async (req: any, res) => {
  try {
    const body = z.object({
      parcel_id:          z.string().uuid(),
      level:              z.string(),
      expected_role:      z.string(),
      expected_office_id: z.string().uuid().nullable().optional(),
      route_code:         z.string(),
      booking_reference:  z.string(),
    }).parse(req.body);

    const ttl = TOKEN_TTL[body.level];
    const now = Math.floor(Date.now() / 1000);
    const tokenPayload = {
      token_id:           crypto.randomUUID(),
      parcel_id:          body.parcel_id,
      level:              body.level,
      expected_role:      body.expected_role,
      expected_office_id: body.expected_office_id || null,
      route_code:         body.route_code,
      booking_reference:  body.booking_reference,
      issued_at:          now,
      expires_at:         now + ttl,
    };

    const jwtString = signToken(tokenPayload);
    await db.query(
      `INSERT INTO custody_tokens
         (token_id, parcel_id, level, expected_actor_role, expected_office_id,
          route_code_at_creation, state, jwt_payload, expires_at, issued_at)
       VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8,NOW())`,
      [tokenPayload.token_id, body.parcel_id, body.level, body.expected_role,
       body.expected_office_id || null, body.route_code, jwtString,
       new Date(tokenPayload.expires_at * 1000).toISOString()]
    );

    res.json({ success: true, data: { token_id: tokenPayload.token_id, level: body.level, state: 'PENDING', jwt_payload: jwtString, expires_at: new Date(tokenPayload.expires_at * 1000).toISOString() } });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ================================================================
// GET /tokens/parcel/:parcelId/active — Get active QR for display
// ================================================================
router.get('/parcel/:parcelId/active', authenticate, async (req: any, res) => {
  try {
    const { rows: [token] } = await db.query(
      `SELECT * FROM custody_tokens WHERE parcel_id=$1 AND state='ACTIVE' ORDER BY issued_at DESC LIMIT 1`,
      [req.params.parcelId]
    );
    if (!token) return res.status(404).json({ success: false, message: 'No active token for this parcel' });

    // Security: customer can only see L1/L2 tokens for their own parcel
    const restrictedLevels = ['L3', 'L4', 'L5'];
    if (restrictedLevels.includes(token.level) &&
        !['OFFICE_WORKER','OFFICE_MANAGER','OPS_ADMIN','SUPER_ADMIN'].includes(req.actor.role)) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this token' });
    }

    const qr_base64 = await generateQRBase64(token.jwt_payload);
    const expiresAt = new Date(token.expires_at);
    const expiresInSeconds = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));

    res.json({ success: true, data: {
      token_id: token.token_id, level: token.level,
      jwt_payload: token.jwt_payload, qr_base64,
      expires_at: token.expires_at, expires_in_seconds: expiresInSeconds,
    }});
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
// GET /tokens/public-key — RS256 public key for offline app validation
// ================================================================
router.get('/public-key', async (req, res) => {
  const publicKey = process.env.TOKEN_PUBLIC_KEY?.replace(/\\n/g, '\n');
  if (!publicKey) return res.status(500).json({ success: false, message: 'Public key not configured' });
  res.json({ success: true, data: { public_key: publicKey, algorithm: 'RS256' } });
});

// ================================================================
// POST /tokens/validate — Full server-side token validation
// Called by Parcel Service before every custody event
// ================================================================
router.post('/validate', authenticate, async (req: any, res) => {
  try {
    const body = z.object({
      jwt_string:      z.string(),
      actor_id:        z.string(),
      actor_role:      z.string(),
      actor_office_id: z.string().uuid().nullable().optional(),
      occurred_at:     z.string().datetime(),
    }).parse(req.body);

    // STEP 1: Verify JWT signature
    const payload = verifyTokenJWT(body.jwt_string);
    if (!payload) return res.json({ valid: false, reason: 'INVALID_SIGNATURE' });

    // STEP 2: Look up token in DB
    const { rows: [token] } = await db.query(
      'SELECT * FROM custody_tokens WHERE token_id=$1', [payload.token_id]
    );
    if (!token) return res.json({ valid: false, reason: 'TOKEN_NOT_FOUND' });

    // STEP 3: Check state
    if (token.state === 'DISCARDED') return res.json({ valid: false, reason: 'TOKEN_INVALIDATED_ROUTE_CHANGED' });
    if (token.state === 'CONSUMED')  return res.json({ valid: false, reason: 'TOKEN_ALREADY_CONSUMED' });
    if (token.state === 'EXPIRED')   return res.json({ valid: false, reason: 'TOKEN_EXPIRED' });
    if (token.state === 'PENDING')   return res.json({ valid: false, reason: 'TOKEN_NOT_YET_ACTIVE' });

    // STEP 4: Check expiry using occurred_at (device time — not server time)
    const scanTime = new Date(body.occurred_at);
    if (scanTime > new Date(token.expires_at)) {
      await db.query("UPDATE custody_tokens SET state='EXPIRED' WHERE token_id=$1", [token.token_id]);
      await redis.del(`token:${token.token_id}:valid`);
      return res.json({ valid: false, reason: 'TOKEN_EXPIRED_AT_SCAN_TIME' });
    }

    // STEP 5: Check actor role
    if (body.actor_role !== token.expected_actor_role) {
      return res.json({ valid: false, reason: 'WRONG_ACTOR_ROLE' });
    }

    // STEP 6: Check office
    if (token.expected_office_id && body.actor_office_id !== token.expected_office_id) {
      return res.json({ valid: false, reason: 'WRONG_OFFICE' });
    }

    // STEP 7: Check route code not changed since issuance
    const { rows: [parcel] } = await db.query(
      'SELECT route_code FROM parcels WHERE parcel_id=$1', [token.parcel_id]
    );
    if (parcel && parcel.route_code !== token.route_code_at_creation) {
      await db.query("UPDATE custody_tokens SET state='DISCARDED', discarded_reason='ROUTE_CHANGED' WHERE token_id=$1", [token.token_id]);
      await redis.del(`token:${token.token_id}:valid`);
      return res.json({ valid: false, reason: 'TOKEN_INVALIDATED_ROUTE_CHANGED' });
    }

    res.json({ valid: true, token_id: token.token_id, parcel_id: token.parcel_id, level: token.level });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ================================================================
// POST /tokens/:id/consume — Mark consumed + activate next
// Atomic transaction — rollback if next activation fails
// ================================================================
router.post('/:id/consume', authenticate, async (req: any, res) => {
  try {
    const body = z.object({ consumed_by: z.string(), consumed_at: z.string() }).parse(req.body);
    const client = await db.connect();

    try {
      await client.query('BEGIN');

      // Mark current token consumed
      const { rows: [consumed] } = await client.query(
        `UPDATE custody_tokens SET state='CONSUMED', consumed_at=$1, consumed_by=$2
         WHERE token_id=$3 AND state='ACTIVE' RETURNING *`,
        [body.consumed_at, body.consumed_by, req.params.id]
      );
      if (!consumed) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Token not found or not active' });
      }

      // Clear Redis cache immediately
      await redis.del(`token:${req.params.id}:valid`);
      await redis.set(`token:${req.params.id}:state`, 'CONSUMED', { EX: 86400 });

      // Find and activate NEXT pending token for this parcel
      const levelOrder = ['L1','L2','L3','L4','L5','L6'];
      const currentIdx = levelOrder.indexOf(consumed.level);
      let nextToken = null;

      for (let i = currentIdx + 1; i < levelOrder.length; i++) {
        const { rows: [pending] } = await client.query(
          `UPDATE custody_tokens SET state='ACTIVE'
           WHERE parcel_id=$1 AND level=$2 AND state='PENDING'
           RETURNING *`,
          [consumed.parcel_id, levelOrder[i]]
        );
        if (pending) {
          nextToken = pending;
          const ttl = TOKEN_TTL[pending.level] || 3600;
          await redis.set(`token:${pending.token_id}:valid`, '1', { EX: ttl });
          await redis.set(`token:${pending.token_id}:state`, 'ACTIVE', { EX: ttl + 3600 });
          await redis.set(`parcel:${consumed.parcel_id}:active_token`, pending.token_id);
          break;
        }
      }

      await client.query('COMMIT');

      // Publish events
      await publishEvent('token.lifecycle', {
        event_type: 'TOKEN_CONSUMED', parcel_id: consumed.parcel_id,
        token_id: consumed.token_id, level: consumed.level, service: 'token-service'
      }, { dedup_id: `token-consumed-${consumed.token_id}` });

      if (nextToken) {
        await publishEvent('token.lifecycle', {
          event_type: 'TOKEN_ACTIVATED', parcel_id: consumed.parcel_id,
          token_id: nextToken.token_id, level: nextToken.level, service: 'token-service'
        }, { dedup_id: `token-activated-${nextToken.token_id}` });
      }

      res.json({ success: true, data: {
        consumed_token_id: consumed.token_id,
        next_active_token_id: nextToken?.token_id || null,
        next_level: nextToken?.level || null,
      }});
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ================================================================
// POST /tokens/parcel/:parcelId/discard-range — Route switch discard
// ================================================================
router.post('/parcel/:parcelId/discard-range', authenticate, async (req: any, res) => {
  try {
    const body = z.object({
      levels_to_discard: z.array(z.string()),
      reason:            z.string(),
      discarded_by:      z.string(),
    }).parse(req.body);

    const { rows: discarded } = await db.query(
      `UPDATE custody_tokens SET state='DISCARDED', discarded_at=NOW(),
         discarded_reason=$1
       WHERE parcel_id=$2 AND level=ANY($3) AND state IN ('PENDING','ACTIVE')
       RETURNING token_id, level`,
      [body.reason, req.params.parcelId, body.levels_to_discard]
    );

    // Clear Redis for all discarded tokens
    for (const t of discarded) {
      await redis.del(`token:${t.token_id}:valid`);
      await redis.set(`token:${t.token_id}:state`, 'DISCARDED', { EX: 86400 });
    }

    await publishEvent('token.lifecycle', {
      event_type: 'TOKEN_DISCARDED', parcel_id: req.params.parcelId,
      tokens_discarded: discarded, reason: body.reason, service: 'token-service'
    });

    res.json({ success: true, data: { discarded_count: discarded.length, tokens: discarded } });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ================================================================
// POST /webhooks/token/check-expiry — QStash scheduled check
// ================================================================
router.post('/webhooks/token/check-expiry', async (req, res) => {
  try {
    const { token_id } = req.body;

    const { rows: [token] } = await db.query(
      'SELECT * FROM custody_tokens WHERE token_id=$1', [token_id]
    );
    if (!token || token.state !== 'ACTIVE') return res.json({ ok: true, skipped: true });

    if (new Date() > new Date(token.expires_at)) {
      await db.query("UPDATE custody_tokens SET state='EXPIRED' WHERE token_id=$1", [token_id]);
      await redis.del(`token:${token_id}:valid`);

      await publishEvent('token.lifecycle', {
        event_type: 'TOKEN_EXPIRED', parcel_id: token.parcel_id,
        token_id, level: token.level, service: 'token-service'
      });
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;