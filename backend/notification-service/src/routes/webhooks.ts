import { Router } from 'express';
import { db } from '../db';
import { redis } from '../redis';
import { publishEvent } from '../qstash';
import {
  sendPush, sendSMS, shouldSendNotification,
  logNotification, renderTemplate, isCritical
} from '../channels';

const router = Router();

// Idempotency guard — all webhook handlers check this first
async function alreadyProcessed(eventId: string): Promise<boolean> {
  const key = `processed:${eventId}`;
  const exists = await redis.get(key);
  if (exists) return true;
  await redis.set(key, '1', { EX: 172800 }); // 48hr TTL
  return false;
}

// Helper: send to a user via appropriate channel with fallback
async function notifyUser(
  userId: string, channel: 'PUSH' | 'SMS',
  templateKey: string, vars: Record<string, string>,
  parcelId: string | null, eventType: string,
  recipientType: string, withSound = false
) {
  const { rows: [user] } = await db.query(
    'SELECT user_id, phone, fcm_token FROM users WHERE user_id=$1', [userId]
  );
  if (!user) return;

  const allowed = await shouldSendNotification(userId, parcelId, eventType, channel, recipientType);
  if (!allowed) return;

  const message = renderTemplate(templateKey, vars);

  if (channel === 'PUSH' && user.fcm_token) {
    const result = await sendPush(user.fcm_token, 'FlexSend', message, { parcel_id: parcelId || '' }, withSound);
    await logNotification(userId, user.phone, 'PUSH', templateKey, message, result.success ? 'SENT' : 'FAILED', parcelId || undefined);

    // Fallback to SMS if push fails and event is critical
    if (!result.success && isCritical(eventType) && user.phone) {
      await publishEvent('notification.fallback', {
        user_id: userId, phone: user.phone,
        template_key: templateKey, vars, parcel_id: parcelId, event_type: eventType
      }, { delay_seconds: 300 });
    }
  } else if (channel === 'SMS' && user.phone) {
    const result = await sendSMS(user.phone, message);
    await logNotification(userId, user.phone, 'SMS', templateKey, message, result.success ? 'SENT' : 'FAILED', parcelId || undefined);
  }
}

// ================================================================
// POST /webhooks/parcel/created
// ================================================================
router.post('/parcel/created', async (req, res) => {
  try {
    const event = req.body;
    if (await alreadyProcessed(event.event_id)) return res.json({ ok: true });

    const { payload, parcel_id } = event;
    const { rows: [parcel] } = await db.query(
      `SELECT p.*, u.phone as sender_phone, u.fcm_token as sender_fcm,
              r.phone as receiver_phone, r.fcm_token as receiver_fcm,
              r.user_id as receiver_id
       FROM parcels p
       LEFT JOIN users u ON u.user_id=p.sender_id
       LEFT JOIN users r ON r.phone=p.receiver_phone
       WHERE p.parcel_id=$1`, [parcel_id]
    );
    if (!parcel) return res.json({ ok: true });

    // Notify sender
    await notifyUser(parcel.sender_id, 'PUSH', 'parcel.created.sender',
      { booking_ref: parcel.booking_reference, deposit_amount: payload.deposit_amount?.toString() || '0' },
      parcel_id, 'PARCEL_CREATED', 'CUSTOMER');

    // Notify receiver via SMS only (may not have app)
    if (parcel.receiver_phone) {
      await sendSMS(parcel.receiver_phone, renderTemplate('parcel.created.receiver', {
        sender_name: payload.sender_name || 'Someone',
        booking_ref: parcel.booking_reference,
      }));
      await logNotification(parcel.receiver_id || 'unknown', parcel.receiver_phone,
        'SMS', 'parcel.created.receiver',
        renderTemplate('parcel.created.receiver', { sender_name: payload.sender_name || '', booking_ref: parcel.booking_reference }),
        'SENT', parcel_id);
    }

    res.json({ ok: true });
  } catch (err: any) {
    console.error('[notif/parcel/created]', err.message);
    res.json({ ok: true, error: err.message });
  }
});

// ================================================================
// POST /webhooks/parcel/rider-assigned
// ================================================================
router.post('/parcel/rider-assigned', async (req, res) => {
  try {
    const event = req.body;
    if (await alreadyProcessed(event.event_id)) return res.json({ ok: true });

    const { payload, parcel_id } = event;
    const { rows: [parcel] } = await db.query(
      'SELECT sender_id, booking_reference FROM parcels WHERE parcel_id=$1', [parcel_id]
    );
    if (!parcel) return res.json({ ok: true });

    // Notify sender
    await notifyUser(parcel.sender_id, 'PUSH', 'parcel.rider_assigned.sender',
      { rider_name: payload.rider_name || 'Your rider', eta: payload.eta || 'soon' },
      parcel_id, 'PARCEL_RIDER_ASSIGNED', 'CUSTOMER');

    // Notify rider — with sound
    if (payload.rider_id) {
      await notifyUser(payload.rider_id, 'PUSH', 'parcel.rider_assigned.rider',
        { pickup_address: payload.pickup_address || '', parcel_count: '1',
          fragile_flag: payload.is_fragile ? 'FRAGILE — handle with care.' : '' },
        parcel_id, 'PARCEL_RIDER_ASSIGNED', 'RIDER', true);
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.json({ ok: true, error: err.message });
  }
});

// ================================================================
// POST /webhooks/parcel/collected
// ================================================================
router.post('/parcel/collected', async (req, res) => {
  try {
    const event = req.body;
    if (await alreadyProcessed(event.event_id)) return res.json({ ok: true });

    const { parcel_id } = event;
    const { rows: [parcel] } = await db.query(
      'SELECT sender_id, booking_reference FROM parcels WHERE parcel_id=$1', [parcel_id]
    );
    if (!parcel) return res.json({ ok: true });

    await notifyUser(parcel.sender_id, 'PUSH', 'parcel.collected.sender',
      { booking_ref: parcel.booking_reference },
      parcel_id, 'PARCEL_COLLECTED_BY_RIDER', 'CUSTOMER');

    res.json({ ok: true });
  } catch (err: any) {
    res.json({ ok: true, error: err.message });
  }
});

// ================================================================
// POST /webhooks/parcel/office-received
// ================================================================
router.post('/parcel/office-received', async (req, res) => {
  try {
    const event = req.body;
    if (await alreadyProcessed(event.event_id)) return res.json({ ok: true });

    const { payload, parcel_id } = event;
    const { rows: [parcel] } = await db.query(
      'SELECT sender_id, booking_reference FROM parcels WHERE parcel_id=$1', [parcel_id]
    );
    if (!parcel) return res.json({ ok: true });

    // Cancel SLA check — parcel received on time
    await redis.set(`sla_completed:${parcel_id}:L2`, 'DONE', { EX: 86400 });

    await notifyUser(parcel.sender_id, 'PUSH', 'parcel.office_received.sender',
      { booking_ref: parcel.booking_reference, office_name: payload.office_name || 'Hub' },
      parcel_id, 'PARCEL_OFFICE_RECEIVED', 'CUSTOMER');

    res.json({ ok: true });
  } catch (err: any) {
    res.json({ ok: true, error: err.message });
  }
});

// ================================================================
// POST /webhooks/parcel/measurement
// ================================================================
router.post('/parcel/measurement', async (req, res) => {
  try {
    const event = req.body;
    if (await alreadyProcessed(event.event_id)) return res.json({ ok: true });

    const { payload, parcel_id, event_type } = event;
    const { rows: [parcel] } = await db.query(
      'SELECT sender_id, booking_reference FROM parcels WHERE parcel_id=$1', [parcel_id]
    );
    if (!parcel) return res.json({ ok: true });

    if (event_type === 'PARCEL_MEASUREMENT_CONFIRMED') {
      await notifyUser(parcel.sender_id, 'PUSH', 'parcel.measurement_confirmed.sender',
        { booking_ref: parcel.booking_reference },
        parcel_id, 'PARCEL_MEASUREMENT_CONFIRMED', 'CUSTOMER');
    } else {
      // Repricing triggered — PUSH + SMS (critical)
      const msg = renderTemplate('parcel.repricing.sender', {
        new_price: payload.new_price?.toString() || '',
        difference: payload.price_difference?.toString() || '',
        deadline_time: payload.deadline_time || '30 minutes',
      });
      const { rows: [user] } = await db.query(
        'SELECT fcm_token, phone FROM users WHERE user_id=$1', [parcel.sender_id]
      );
      if (user?.fcm_token) await sendPush(user.fcm_token, '⚠️ FlexSend — Action Required', msg);
      if (user?.phone) await sendSMS(user.phone, msg);
      await logNotification(parcel.sender_id, user?.phone || '', 'PUSH',
        'parcel.repricing.sender', msg, 'SENT', parcel_id);
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.json({ ok: true, error: err.message });
  }
});

// ================================================================
// POST /webhooks/parcel/repricing
// ================================================================
router.post('/parcel/repricing', async (req, res) => {
  try {
    const event = req.body;
    if (await alreadyProcessed(event.event_id)) return res.json({ ok: true });

    const { event_type, parcel_id } = event;
    const { rows: [parcel] } = await db.query(
      'SELECT sender_id, booking_reference FROM parcels WHERE parcel_id=$1', [parcel_id]
    );
    if (!parcel) return res.json({ ok: true });

    if (event_type === 'PARCEL_REPRICING_ACCEPTED') {
      await notifyUser(parcel.sender_id, 'PUSH', 'parcel.repricing_accepted.sender',
        { booking_ref: parcel.booking_reference },
        parcel_id, 'PARCEL_REPRICING_ACCEPTED', 'CUSTOMER');
    } else if (event_type === 'PARCEL_REPRICING_REJECTED') {
      const { rows: [user] } = await db.query(
        'SELECT fcm_token, phone FROM users WHERE user_id=$1', [parcel.sender_id]
      );
      const msg = renderTemplate('parcel.repricing_rejected.sender', { booking_ref: parcel.booking_reference });
      if (user?.fcm_token) await sendPush(user.fcm_token, 'FlexSend', msg);
      if (user?.phone) await sendSMS(user.phone, msg);
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.json({ ok: true, error: err.message });
  }
});

// ================================================================
// POST /webhooks/parcel/courier-dispatched
// ================================================================
router.post('/parcel/courier-dispatched', async (req, res) => {
  try {
    const event = req.body;
    if (await alreadyProcessed(event.event_id)) return res.json({ ok: true });

    const { payload, parcel_id } = event;
    const { rows: [parcel] } = await db.query(
      'SELECT sender_id, receiver_phone, booking_reference FROM parcels WHERE parcel_id=$1', [parcel_id]
    );
    if (!parcel) return res.json({ ok: true });

    // Sender — push + SMS
    const { rows: [sender] } = await db.query(
      'SELECT fcm_token, phone FROM users WHERE user_id=$1', [parcel.sender_id]
    );
    const senderMsg = renderTemplate('parcel.courier_dispatched.sender', {
      booking_ref: parcel.booking_reference, dest_city: payload.dest_city || ''
    });
    if (sender?.fcm_token) await sendPush(sender.fcm_token, 'FlexSend', senderMsg);
    if (sender?.phone) await sendSMS(sender.phone, senderMsg);

    // Receiver — SMS only (first major SMS)
    if (parcel.receiver_phone) {
      const receiverMsg = renderTemplate('parcel.courier_dispatched.receiver', {
        origin_city: payload.origin_city || '', eta_date: payload.eta_date || 'soon'
      });
      await sendSMS(parcel.receiver_phone, receiverMsg);
      await redis.incr(`sms_count:${parcel.receiver_phone}:${parcel_id}`);
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.json({ ok: true, error: err.message });
  }
});

// ================================================================
// POST /webhooks/parcel/box-arrived
// ================================================================
router.post('/parcel/box-arrived', async (req, res) => {
  try {
    const event = req.body;
    if (await alreadyProcessed(event.event_id)) return res.json({ ok: true });

    const { payload, parcel_id } = event;
    const { rows: [parcel] } = await db.query(
      'SELECT sender_id, receiver_phone, booking_reference FROM parcels WHERE parcel_id=$1', [parcel_id]
    );
    if (!parcel) return res.json({ ok: true });

    await notifyUser(parcel.sender_id, 'PUSH', 'parcel.box_arrived.sender',
      { booking_ref: parcel.booking_reference, dest_city: payload.dest_city || '' },
      parcel_id, 'PARCEL_BOX_ARRIVED_GEOFENCE', 'CUSTOMER');

    if (parcel.receiver_phone) {
      await sendSMS(parcel.receiver_phone, renderTemplate('parcel.box_arrived.receiver', {
        city: payload.dest_city || ''
      }));
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.json({ ok: true, error: err.message });
  }
});

// ================================================================
// POST /webhooks/parcel/last-mile-assigned
// ================================================================
router.post('/parcel/last-mile-assigned', async (req, res) => {
  try {
    const event = req.body;
    if (await alreadyProcessed(event.event_id)) return res.json({ ok: true });

    const { payload, parcel_id } = event;
    const { rows: [parcel] } = await db.query(
      'SELECT sender_id, receiver_id, receiver_phone, booking_reference FROM parcels WHERE parcel_id=$1', [parcel_id]
    );
    if (!parcel) return res.json({ ok: true });

    const receiverMsg = renderTemplate('parcel.last_mile_assigned.receiver', {
      rider_name: payload.rider_name || 'Your rider', eta: payload.eta || 'soon'
    });

    // Receiver — push (if has app) + SMS
    if (parcel.receiver_id) {
      await notifyUser(parcel.receiver_id, 'PUSH', 'parcel.last_mile_assigned.receiver',
        { rider_name: payload.rider_name || '', eta: payload.eta || '' },
        parcel_id, 'PARCEL_LAST_MILE_RIDER_ASSIGNED', 'RECEIVER');
    }
    if (parcel.receiver_phone) {
      await sendSMS(parcel.receiver_phone, receiverMsg);
    }

    // Sender
    await notifyUser(parcel.sender_id, 'PUSH', 'parcel.last_mile_assigned.sender',
      { booking_ref: parcel.booking_reference },
      parcel_id, 'PARCEL_LAST_MILE_RIDER_ASSIGNED', 'CUSTOMER');

    res.json({ ok: true });
  } catch (err: any) {
    res.json({ ok: true, error: err.message });
  }
});

// ================================================================
// POST /webhooks/parcel/delivered
// ================================================================
router.post('/parcel/delivered', async (req, res) => {
  try {
    const event = req.body;
    if (await alreadyProcessed(event.event_id)) return res.json({ ok: true });

    const { payload, parcel_id } = event;
    const { rows: [parcel] } = await db.query(
      `SELECT p.*, u.fcm_token as sender_fcm, u.phone as sender_phone,
              a.user_id as agent_id, a.fcm_token as agent_fcm
       FROM parcels p
       LEFT JOIN users u ON u.user_id=p.sender_id
       LEFT JOIN users a ON a.user_id=p.agent_id
       WHERE p.parcel_id=$1`, [parcel_id]
    );
    if (!parcel) return res.json({ ok: true });

    // Sender — push + SMS
    const senderMsg = renderTemplate('parcel.delivered.sender', { booking_ref: parcel.booking_reference });
    if (parcel.sender_fcm) await sendPush(parcel.sender_fcm, 'FlexSend ✅', senderMsg);
    if (parcel.sender_phone) await sendSMS(parcel.sender_phone, senderMsg);

    // Receiver — push
    if (parcel.receiver_id) {
      await notifyUser(parcel.receiver_id, 'PUSH', 'parcel.delivered.receiver',
        {}, parcel_id, 'PARCEL_DELIVERY_CONFIRMED', 'RECEIVER');
    }

    // Agent commission notification
    if (parcel.agent_id && parcel.agent_fcm && payload.commission_amount) {
      await sendPush(parcel.agent_fcm, 'FlexSend 💰',
        renderTemplate('parcel.delivered.agent', {
          booking_ref: parcel.booking_reference,
          commission_amount: payload.commission_amount?.toString() || ''
        }));
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.json({ ok: true, error: err.message });
  }
});

// ================================================================
// POST /webhooks/parcel/delivery-failed
// ================================================================
router.post('/parcel/delivery-failed', async (req, res) => {
  try {
    const event = req.body;
    if (await alreadyProcessed(event.event_id)) return res.json({ ok: true });

    const { payload, parcel_id } = event;
    const { rows: [parcel] } = await db.query(
      'SELECT sender_id, receiver_phone, receiver_id, booking_reference FROM parcels WHERE parcel_id=$1', [parcel_id]
    );
    if (!parcel) return res.json({ ok: true });

    // Receiver — SMS critical (must reach without app)
    const deadline = new Date(Date.now() + 48 * 3600 * 1000).toLocaleDateString('en-TZ', { timeZone: 'Africa/Dar_es_Salaam' });
    if (parcel.receiver_phone) {
      await sendSMS(parcel.receiver_phone, renderTemplate('parcel.delivery_failed.receiver', {
        booking_ref: parcel.booking_reference,
        response_deadline: deadline,
        office_name: payload.office_name || 'our nearest office',
      }));
    }

    // Sender
    await notifyUser(parcel.sender_id, 'PUSH', 'parcel.delivery_failed.sender',
      { booking_ref: parcel.booking_reference, attempt_count: payload.attempt_count?.toString() || '1' },
      parcel_id, 'PARCEL_DELIVERY_FAILED', 'CUSTOMER');

    res.json({ ok: true });
  } catch (err: any) {
    res.json({ ok: true, error: err.message });
  }
});

// ================================================================
// POST /webhooks/ml/alerts
// ================================================================
router.post('/ml/alerts', async (req, res) => {
  try {
    const event = req.body;
    if (await alreadyProcessed(event.event_id)) return res.json({ ok: true });

    const { payload } = event;
    const level = payload.alert_level;

    // Level 1 — log only, no notification
    if (level <= 1) return res.json({ ok: true });

    // Get ops admin users
    const { rows: opsAdmins } = await db.query(
      "SELECT user_id, fcm_token, phone FROM users WHERE role='OPS_ADMIN' AND fcm_token IS NOT NULL"
    );
    const { rows: officeManagers } = await db.query(
      "SELECT user_id, fcm_token, phone FROM users WHERE role='OFFICE_MANAGER' AND fcm_token IS NOT NULL"
    );

    const alertMsg = `[Level ${level}] ${payload.alert_type}: ${payload.description}`;

    if (level >= 2) {
      // Office manager — dashboard alert only (push for level 3+)
      if (level >= 3) {
        for (const mgr of officeManagers) {
          if (mgr.fcm_token) await sendPush(mgr.fcm_token, '⚠️ FlexSend Alert', alertMsg);
        }
      }
    }

    if (level >= 3) {
      for (const admin of opsAdmins) {
        if (admin.fcm_token) await sendPush(admin.fcm_token, `🚨 Level ${level} Alert`, alertMsg);
        if (level >= 4 && admin.phone) await sendSMS(admin.phone, alertMsg);
      }
    }

    if (level >= 5) {
      const { rows: superAdmins } = await db.query(
        "SELECT phone FROM users WHERE role='SUPER_ADMIN'"
      );
      for (const sa of superAdmins) {
        if (sa.phone) await sendSMS(sa.phone, alertMsg);
      }
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.json({ ok: true, error: err.message });
  }
});

// ================================================================
// POST /webhooks/payment/transactions
// ================================================================
router.post('/payment/transactions', async (req, res) => {
  try {
    const event = req.body;
    if (await alreadyProcessed(event.event_id)) return res.json({ ok: true });

    const { event_type, payload, parcel_id } = event;
    const { rows: [parcel] } = await db.query(
      'SELECT sender_id, booking_reference FROM parcels WHERE parcel_id=$1', [parcel_id]
    );
    if (!parcel) return res.json({ ok: true });

    if (event_type === 'PAYMENT_DEPOSIT_CONFIRMED' || event_type === 'PAYMENT_BALANCE_CONFIRMED') {
      await notifyUser(parcel.sender_id, 'PUSH', 'payment.confirmed.sender',
        { booking_ref: parcel.booking_reference, amount: payload.amount?.toString() || '', balance_due: payload.balance_due?.toString() || '0' },
        parcel_id, event_type, 'CUSTOMER');
    } else if (event_type === 'PAYMENT_DEPOSIT_FAILED') {
      const { rows: [user] } = await db.query('SELECT fcm_token, phone FROM users WHERE user_id=$1', [parcel.sender_id]);
      const msg = renderTemplate('payment.failed.sender', { booking_ref: parcel.booking_reference });
      if (user?.fcm_token) await sendPush(user.fcm_token, 'FlexSend ❌', msg);
      if (user?.phone) await sendSMS(user.phone, msg);
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.json({ ok: true, error: err.message });
  }
});

export default router;