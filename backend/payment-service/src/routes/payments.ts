import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { db } from '../db';
import { redis } from '../redis';
import { authenticate } from '../middleware';
import { publishEvent } from '../qstash';
import {
  initiateAzamPaySTK, initiateAzamPayRefund,
  verifyAzamPaySignature, isValidTransition,
  AGENT_COMMISSION_RATE, RIDER_BASE_EARNINGS
} from '../azampay';

const router = Router();

// ================================================================
// POST /payments/initiate — Start a payment (internal, Parcel Service only)
// Idempotent: same idempotency_key returns existing record
// ================================================================
router.post('/initiate', authenticate, async (req: any, res) => {
  try {
    const body = z.object({
      parcel_id:       z.string().uuid(),
      amount:          z.number().positive(),
      currency:        z.string().default('TZS'),
      payment_type:    z.enum(['DEPOSIT','BALANCE','FULL','REPRICE','REFUND']),
      provider:        z.enum(['MPESA','TIGO_PESA','AIRTEL_MONEY','HALOPESA']),
      phone_number:    z.string(),
      idempotency_key: z.string(),
      description:     z.string(),
    }).parse(req.body);

    // Idempotency — return existing if key already exists
    const { rows: [existing] } = await db.query(
      'SELECT * FROM payment_records WHERE idempotency_key=$1', [body.idempotency_key]
    );
    if (existing) {
      return res.json({ success: true, data: {
        payment_id: existing.payment_id,
        status: existing.status,
        message: 'Existing payment returned (idempotent)',
        poll_url: `/payments/${existing.payment_id}`,
      }});
    }

    // Create PENDING record first — DB before external call
    const paymentId = crypto.randomUUID();
    await db.query(
      `INSERT INTO payment_records
         (payment_id, parcel_id, amount, currency, payment_type, status,
          provider, phone_number, idempotency_key, retry_count, initiated_at)
       VALUES ($1,$2,$3,$4,$5,'PENDING',$6,$7,$8,0,NOW())`,
      [paymentId, body.parcel_id, body.amount, body.currency, body.payment_type,
       body.provider, body.phone_number, body.idempotency_key]
    );

    // Initiate STK push
    const stkResult = await initiateAzamPaySTK({
      amount: body.amount,
      phone_number: body.phone_number,
      idempotency_key: body.idempotency_key,
      description: body.description,
      provider: body.provider,
    });

    if (stkResult.success) {
      await db.query(
        `UPDATE payment_records SET status='PROCESSING', provider_ref=$1 WHERE payment_id=$2`,
        [stkResult.provider_ref || null, paymentId]
      );
    } else {
      await db.query(
        `UPDATE payment_records SET status='FAILED', failure_reason=$1 WHERE payment_id=$2`,
        [stkResult.error || 'STK push failed', paymentId]
      );
    }

    res.status(201).json({ success: true, data: {
      payment_id: paymentId,
      status: stkResult.success ? 'PROCESSING' : 'FAILED',
      message: stkResult.success
        ? `STK push sent to ${body.phone_number}`
        : `STK push failed: ${stkResult.error}`,
      poll_url: `/payments/${paymentId}`,
    }});
  } catch (err: any) {
    if (err.code === '23505') { // UNIQUE violation
      return res.status(409).json({ success: false, message: 'Duplicate idempotency key — use new key for retry' });
    }
    res.status(400).json({ success: false, message: err.message });
  }
});

// ================================================================
// POST /payments/webhook/azampay — Azam Pay payment result
// ALWAYS returns 200 — never expose 4xx to payment providers
// ================================================================
router.post('/webhook/azampay', async (req, res) => {
  try {
    const signature = req.headers['x-azampay-signature'] as string || '';

    // STEP 1: Verify HMAC signature FIRST — before any processing
    if (!verifyAzamPaySignature(req.body, signature)) {
      console.error('[payment] Invalid Azam Pay signature — discarded');
      return res.status(200).json({ ok: true, error: 'Invalid signature — discarded' });
    }

    const { transactionStatus, transactionID, referenceID, amount, msisdn } = req.body;

    // STEP 2: Find payment by idempotency_key (referenceID) or provider_ref
    const { rows: [payment] } = await db.query(
      `SELECT * FROM payment_records WHERE idempotency_key=$1 OR provider_ref=$2`,
      [referenceID, transactionID]
    );

    if (!payment) {
      console.error(`[payment] Payment not found: ref=${referenceID}, txn=${transactionID}`);
      return res.status(200).json({ ok: true, error: 'Payment not found' });
    }

    // STEP 3: Idempotency — already processed
    if (payment.status === 'CONFIRMED' || payment.status === 'REFUNDED') {
      return res.status(200).json({ ok: true, message: 'Already processed' });
    }

    const newStatus = transactionStatus === 'success' ? 'CONFIRMED' : 'FAILED';

    // STEP 4: Validate state transition
    if (!isValidTransition(payment.status, newStatus)) {
      console.error(`[payment] Invalid transition ${payment.status} → ${newStatus}`);
      return res.status(200).json({ ok: true, error: 'Invalid state transition' });
    }

    // STEP 5: Update DB
    if (newStatus === 'CONFIRMED') {
      await db.query(
        `UPDATE payment_records SET status='CONFIRMED', provider_ref=$1, confirmed_at=NOW() WHERE payment_id=$2`,
        [transactionID, payment.payment_id]
      );
    } else {
      await db.query(
        `UPDATE payment_records SET status='FAILED', failure_reason=$1, failed_at=NOW() WHERE payment_id=$2`,
        [`Provider status: ${transactionStatus}`, payment.payment_id]
      );
    }

    // STEP 6: Publish event — notify parcel service and notification service
    const eventType = newStatus === 'CONFIRMED'
      ? (payment.payment_type === 'DEPOSIT' ? 'PAYMENT_DEPOSIT_CONFIRMED' : 'PAYMENT_BALANCE_CONFIRMED')
      : 'PAYMENT_DEPOSIT_FAILED';

    await publishEvent('payment.transactions', {
      event_id:    crypto.randomUUID(),
      event_type:  eventType,
      parcel_id:   payment.parcel_id,
      payment_id:  payment.payment_id,
      amount:      payment.amount,
      payment_type: payment.payment_type,
      provider_ref: transactionID,
      service:     'payment-service',
    }, { dedup_id: `payment-${payment.payment_id}-${newStatus}` });

    // Cancel repricing deadline if payment was for repricing
    if (payment.payment_type === 'REPRICE' && newStatus === 'CONFIRMED') {
      await redis.set(`repricing_paid:${payment.parcel_id}`, 'DONE', { EX: 86400 });
    }

    res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('[payment/webhook]', err.message);
    res.status(200).json({ ok: true, error: err.message }); // Always 200 for payment webhooks
  }
});

// ================================================================
// GET /payments/:id — Payment status
// ================================================================
router.get('/:id', authenticate, async (req: any, res) => {
  try {
    const { rows: [payment] } = await db.query(
      'SELECT * FROM payment_records WHERE payment_id=$1', [req.params.id]
    );
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });

    // Customer can only view their own payments
    if (req.actor.role === 'CUSTOMER') {
      const { rows: [parcel] } = await db.query(
        'SELECT sender_id FROM parcels WHERE parcel_id=$1', [payment.parcel_id]
      );
      if (!parcel || parcel.sender_id !== req.actor.user_id) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    }

    res.json({ success: true, data: payment });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
// GET /payments/parcel/:parcelId — All payments for a parcel
// ================================================================
router.get('/parcel/:parcelId', authenticate, async (req: any, res) => {
  try {
    if (!['SUPPORT_AGENT','OPS_ADMIN','SUPER_ADMIN'].includes(req.actor.role)) {
      return res.status(403).json({ success: false, message: 'Support/Ops only' });
    }
    const { rows } = await db.query(
      'SELECT * FROM payment_records WHERE parcel_id=$1 ORDER BY initiated_at ASC',
      [req.params.parcelId]
    );
    res.json({ success: true, data: rows });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
// POST /payments/refund — Initiate a refund
// ================================================================
router.post('/refund', authenticate, async (req: any, res) => {
  try {
    if (!['SUPPORT_AGENT','OPS_ADMIN','SUPER_ADMIN'].includes(req.actor.role)) {
      return res.status(403).json({ success: false, message: 'Support/Ops only' });
    }

    const body = z.object({
      parcel_id:            z.string().uuid(),
      amount:               z.number().positive(),
      reason:               z.string(),
      original_payment_id:  z.string().uuid(),
    }).parse(req.body);

    // Validate original payment is CONFIRMED
    const { rows: [original] } = await db.query(
      'SELECT * FROM payment_records WHERE payment_id=$1', [body.original_payment_id]
    );
    if (!original || original.status !== 'CONFIRMED') {
      return res.status(400).json({ success: false, message: 'Original payment not confirmed' });
    }
    if (original.parcel_id !== body.parcel_id) {
      return res.status(400).json({ success: false, message: 'Payment does not belong to this parcel' });
    }

    // Create refund record
    const refundId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();

    await db.query(
      `INSERT INTO payment_records
         (payment_id, parcel_id, amount, currency, payment_type, status,
          provider, phone_number, idempotency_key, failure_reason, retry_count, initiated_at)
       VALUES ($1,$2,$3,'TZS','REFUND','PENDING',$4,$5,$6,$7,0,NOW())`,
      [refundId, body.parcel_id, body.amount, original.provider,
       original.phone_number, idempotencyKey, body.reason]
    );

    // Initiate Azam Pay refund
    const refundResult = await initiateAzamPayRefund({
      original_provider_ref: original.provider_ref,
      amount: body.amount,
      phone_number: original.phone_number,
    });

    if (refundResult.success) {
      await db.query(
        `UPDATE payment_records SET status='PROCESSING', provider_ref=$1 WHERE payment_id=$2`,
        [refundResult.refund_ref, refundId]
      );
    } else {
      await db.query(
        `UPDATE payment_records SET status='FAILED', failure_reason=$1 WHERE payment_id=$2`,
        [refundResult.error, refundId]
      );
    }

    await publishEvent('payment.refunds', {
      event_id:    crypto.randomUUID(),
      event_type:  'PAYMENT_REFUND_INITIATED',
      parcel_id:   body.parcel_id,
      refund_id:   refundId,
      amount:      body.amount,
      reason:      body.reason,
      service:     'payment-service',
    });

    res.status(201).json({ success: true, data: {
      refund_id: refundId,
      amount: body.amount,
      status: refundResult.success ? 'PROCESSING' : 'FAILED',
      expected_arrival: '1-3 business days',
    }});
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ================================================================
// POST /webhooks/parcel/delivered — Commission + earnings trigger
// Called by QStash on PARCEL_DELIVERY_CONFIRMED
// ONLY credit AFTER full delivery — never earlier
// ================================================================
router.post('/webhooks/parcel/delivered', async (req, res) => {
  try {
    const event = req.body;

    // Idempotency
    const processed = await redis.get(`processed:${event.event_id}`);
    if (processed) return res.json({ ok: true });
    await redis.set(`processed:${event.event_id}`, '1', { EX: 172800 });

    const { parcel_id } = event;
    const { rows: [parcel] } = await db.query(
      `SELECT p.*, a.commission_rate as agent_rate
       FROM parcels p
       LEFT JOIN agents a ON a.user_id=p.agent_id
       WHERE p.parcel_id=$1`, [parcel_id]
    );
    if (!parcel) return res.json({ ok: true });

    const confirmedPayment = await db.query(
      `SELECT SUM(amount) as total FROM payment_records
       WHERE parcel_id=$1 AND status='CONFIRMED' AND payment_type IN ('DEPOSIT','BALANCE','FULL','REPRICE')`,
      [parcel_id]
    );
    const bookingAmount = parseFloat(confirmedPayment.rows[0]?.total || '0');

    // Agent commission — only on delivery, never earlier
    if (parcel.agent_id && bookingAmount > 0) {
      const rate = parseFloat(parcel.agent_rate || String(AGENT_COMMISSION_RATE));
      const commissionAmount = bookingAmount * rate;
      const commissionId = crypto.randomUUID();

      await db.query(
        `INSERT INTO agent_commissions
           (commission_id, agent_id, parcel_id, booking_amount, commission_rate,
            commission_amount, status, earned_at)
         VALUES ($1,$2,$3,$4,$5,$6,'PENDING',NOW())
         ON CONFLICT DO NOTHING`,
        [commissionId, parcel.agent_id, parcel_id, bookingAmount, rate, commissionAmount]
      );

      await db.query(
        'UPDATE users SET total_bookings = total_bookings + 1 WHERE user_id=$1',
        [parcel.agent_id]
      );

      await publishEvent('payment.commissions', {
        event_id:          crypto.randomUUID(),
        event_type:        'AGENT_COMMISSION_EARNED',
        agent_id:          parcel.agent_id,
        parcel_id,
        commission_id:     commissionId,
        commission_amount: commissionAmount,
        service:           'payment-service',
      }, { dedup_id: `commission-${parcel_id}` });
    }

    // Rider earnings — pickup rider
    if (parcel.assigned_rider_id) {
      const earningId = crypto.randomUUID();
      const amount = RIDER_BASE_EARNINGS.PICKUP;
      await db.query(
        `INSERT INTO rider_earnings
           (earning_id, rider_id, parcel_id, job_type, amount, status, earned_at)
         VALUES ($1,$2,$3,'PICKUP',$4,'PENDING',NOW())
         ON CONFLICT DO NOTHING`,
        [earningId, parcel.assigned_rider_id, parcel_id, amount]
      );
    }

    // Rider earnings — delivery rider
    if (parcel.last_mile_rider_id) {
      const earningId = crypto.randomUUID();
      const amount = RIDER_BASE_EARNINGS.DELIVERY;
      await db.query(
        `INSERT INTO rider_earnings
           (earning_id, rider_id, parcel_id, job_type, amount, status, earned_at)
         VALUES ($1,$2,$3,'DELIVERY',$4,'PENDING',NOW())
         ON CONFLICT DO NOTHING`,
        [earningId, parcel.last_mile_rider_id, parcel_id, amount]
      );
    }

    await publishEvent('payment.commissions', {
      event_id:   crypto.randomUUID(),
      event_type: 'RIDER_EARNING_CREDITED',
      parcel_id,
      pickup_rider_id:   parcel.assigned_rider_id,
      delivery_rider_id: parcel.last_mile_rider_id,
      service:           'payment-service',
    }, { dedup_id: `rider-earnings-${parcel_id}` });

    res.json({ ok: true });
  } catch (err: any) {
    console.error('[payment/delivered]', err.message);
    res.json({ ok: true, error: err.message }); // Always 200 for QStash
  }
});

// ================================================================
// GET /payments/commissions/:agentId
// ================================================================
router.get('/commissions/:agentId', authenticate, async (req: any, res) => {
  try {
    const { agentId } = req.params;
    if (req.actor.role === 'AGENT' && req.actor.user_id !== agentId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    if (!['AGENT','BRANCH_MANAGER','OPS_ADMIN','SUPER_ADMIN'].includes(req.actor.role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const fromDate = req.query.from || new Date(Date.now() - 30 * 86400000).toISOString();
    const toDate   = req.query.to   || new Date().toISOString();

    const { rows } = await db.query(
      `SELECT ac.*, p.booking_reference
       FROM agent_commissions ac
       JOIN parcels p ON p.parcel_id = ac.parcel_id
       WHERE ac.agent_id=$1 AND ac.earned_at BETWEEN $2 AND $3
       ORDER BY ac.earned_at DESC`,
      [agentId, fromDate, toDate]
    );

    const total_earned    = rows.reduce((s: number, r: any) => s + parseFloat(r.commission_amount), 0);
    const total_pending   = rows.filter((r: any) => r.status === 'PENDING').reduce((s: number, r: any) => s + parseFloat(r.commission_amount), 0);
    const total_paid      = rows.filter((r: any) => r.status === 'PAID').reduce((s: number, r: any) => s + parseFloat(r.commission_amount), 0);

    res.json({ success: true, data: { commissions: rows, summary: { total_earned, total_pending, total_paid } } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
// GET /payments/earnings/:riderId
// ================================================================
router.get('/earnings/:riderId', authenticate, async (req: any, res) => {
  try {
    const { riderId } = req.params;
    if (req.actor.role === 'RIDER' && req.actor.user_id !== riderId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    if (!['RIDER','OFFICE_MANAGER','OPS_ADMIN','SUPER_ADMIN'].includes(req.actor.role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { rows } = await db.query(
      `SELECT re.*, p.booking_reference
       FROM rider_earnings re
       JOIN parcels p ON p.parcel_id = re.parcel_id
       WHERE re.rider_id=$1
       ORDER BY re.earned_at DESC LIMIT 100`,
      [riderId]
    );

    const total_pending   = rows.filter((r: any) => r.status === 'PENDING').reduce((s: number, r: any) => s + parseFloat(r.amount), 0);
    const total_confirmed = rows.filter((r: any) => r.status === 'CONFIRMED').reduce((s: number, r: any) => s + parseFloat(r.amount), 0);
    const total_paid      = rows.filter((r: any) => r.status === 'PAID').reduce((s: number, r: any) => s + parseFloat(r.amount), 0);

    // Daily totals for last 7 days
    const { rows: daily } = await db.query(
      `SELECT DATE(earned_at) as date, SUM(amount) as total
       FROM rider_earnings WHERE rider_id=$1 AND earned_at > NOW() - INTERVAL '7 days'
       GROUP BY DATE(earned_at) ORDER BY date DESC`,
      [riderId]
    );

    res.json({ success: true, data: {
      earnings: rows,
      summary: { total_pending, total_confirmed, total_paid },
      daily_totals: daily,
    }});
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;