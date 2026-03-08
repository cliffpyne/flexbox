import * as admin from 'firebase-admin';
import { db } from './db';
import { redis } from './redis';
import 'dotenv/config';

// ── Firebase FCM ────────────────────────────────────────────────────────────
let firebaseInitialized = false;
function initFirebase() {
  if (firebaseInitialized) return;
  try {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccount) { console.warn('[FCM] FIREBASE_SERVICE_ACCOUNT not set'); return; }
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(serviceAccount)) });
    firebaseInitialized = true;
  } catch (err: any) { console.error('[FCM] Init error:', err.message); }
}

export async function sendPush(
  fcmToken: string,
  title: string,
  body: string,
  data?: object,
  withSound = false
): Promise<{ success: boolean; error?: string }> {
  initFirebase();
  if (!firebaseInitialized) {
    console.log(`[PUSH DEV] ${title}: ${body}`);
    return { success: true };
  }
  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data: data ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) : undefined,
      android: {
        priority: 'high',
        notification: { sound: withSound ? 'job_assigned' : 'default', channelId: 'flexsend_parcels' }
      },
      apns: { payload: { aps: { sound: withSound ? 'job_assigned.caf' : 'default', badge: 1 } } }
    });
    return { success: true };
  } catch (err: any) {
    // Stale token — clear it immediately
    if (err.code === 'messaging/registration-token-not-registered') {
      await db.query('UPDATE users SET fcm_token = NULL WHERE fcm_token = $1', [fcmToken]);
    }
    return { success: false, error: err.code };
  }
}

// ── AfricasTalking SMS ──────────────────────────────────────────────────────
let AT: any = null;
function initAT() {
  if (AT) return;
  try {
    const AfricasTalking = require('africastalking');
    AT = AfricasTalking({ apiKey: process.env.AT_API_KEY!, username: process.env.AT_USERNAME! });
  } catch (err: any) { console.error('[SMS] AfricasTalking init error:', err.message); }
}

export async function sendSMS(phone: string, message: string): Promise<{ success: boolean; error?: string }> {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[SMS DEV] ${phone}: ${message}`);
    return { success: true };
  }
  initAT();
  if (!AT) return { success: false, error: 'AT not initialized' };
  try {
    const result = await AT.SMS.send({ to: [phone], message, from: process.env.AT_SENDER_ID });
    const recipient = result.SMSMessageData.Recipients[0];
    return { success: recipient.status === 'Success' };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ── Suppression Engine ──────────────────────────────────────────────────────
const CRITICAL_EVENTS = [
  'PARCEL_REPRICING_TRIGGERED', 'PARCEL_DELIVERY_FAILED',
  'PARCEL_RETURN_INITIATED', 'ML_ALERT_LEVEL_4', 'ML_ALERT_LEVEL_5',
];
export function isCritical(eventType: string): boolean {
  return CRITICAL_EVENTS.includes(eventType);
}

export async function shouldSendNotification(
  recipientId: string, parcelId: string | null,
  eventType: string, channel: string, recipientType: string
): Promise<boolean> {
  // 1. Check active viewing (suppress non-critical if viewing live)
  if (parcelId) {
    const isViewing = await redis.get(`viewing:${recipientId}:${parcelId}`);
    if (isViewing && !isCritical(eventType)) return false;
  }

  // 2. Quiet hours — 22:00 to 07:00 EAT
  const hour = parseInt(new Date().toLocaleString('en-TZ', {
    timeZone: 'Africa/Dar_es_Salaam', hour: '2-digit', hour12: false
  }).split(':')[0]);
  if ((hour >= 22 || hour < 7) && !isCritical(eventType)) {
    if (parcelId) await queueForMorning(recipientId, parcelId, eventType);
    return false;
  }

  // 3. 3-minute batching window
  if (parcelId) {
    const recentKey = `notif_recent:${recipientId}:${parcelId}`;
    const recent = await redis.get(recentKey);
    if (recent && !isCritical(eventType)) {
      await appendToBatch(recipientId, parcelId, eventType);
      return false;
    }
    await redis.set(recentKey, eventType, { EX: 180 });
  }

  // 4. Receiver SMS limit — max 4 per journey
  if (recipientType === 'RECEIVER' && channel === 'SMS' && parcelId) {
    const countKey = `sms_count:${recipientId}:${parcelId}`;
    const count = parseInt((await redis.get(countKey)) || '0');
    if (count >= 4) return false;
    await redis.incr(countKey);
    await redis.expire(countKey, 2592000);
  }

  return true;
}

async function queueForMorning(recipientId: string, parcelId: string, eventType: string) {
  const key = `morning_queue:${recipientId}`;
  const existing = await redis.get(key) || '[]';
  const queue = JSON.parse(existing);
  queue.push({ parcel_id: parcelId, event_type: eventType, queued_at: new Date().toISOString() });
  await redis.set(key, JSON.stringify(queue), { EX: 43200 }); // 12hr TTL
}

async function appendToBatch(recipientId: string, parcelId: string, eventType: string) {
  const key = `notif_batch:${recipientId}:${parcelId}`;
  const existing = await redis.get(key) || '[]';
  const batch = JSON.parse(existing);
  batch.push(eventType);
  await redis.set(key, JSON.stringify(batch), { EX: 180 });
}

// ── Notification Logger ──────────────────────────────────────────────────────
export async function logNotification(
  recipientId: string, recipientPhone: string,
  channel: string, templateKey: string, message: string,
  status: 'SENT' | 'FAILED', parcelId?: string
) {
  await db.query(
    `INSERT INTO notification_log
       (notification_id, parcel_id, recipient_id, recipient_phone, channel,
        template_key, message, status, sent_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())`,
    [crypto.randomUUID(), parcelId || null, recipientId, recipientPhone,
     channel, templateKey, message, status]
  );
}

// ── Template Renderer ────────────────────────────────────────────────────────
export function renderTemplate(templateKey: string, vars: Record<string, string>): string {
  const templates: Record<string, string> = {
    'parcel.created.sender':
      'Booking confirmed! Your parcel {{booking_ref}} is booked. Deposit paid: TZS {{deposit_amount}}. Track at flexsend.co.tz/track/{{booking_ref}}',
    'parcel.created.receiver':
      'A parcel is on its way from {{sender_name}} ({{booking_ref}}). We will update you as it progresses.',
    'parcel.rider_assigned.sender':
      'Your rider {{rider_name}} is on the way to collect your parcel. ETA: {{eta}}.',
    'parcel.rider_assigned.rider':
      'New job: Pick up {{parcel_count}} parcel from {{pickup_address}}. {{fragile_flag}} Open app to accept.',
    'parcel.collected.sender':
      'Rider has collected your parcel {{booking_ref}}. Now heading to our office.',
    'parcel.office_received.sender':
      'Parcel {{booking_ref}} received at {{office_name}}. Being processed.',
    'parcel.measurement_confirmed.sender':
      'Measurements confirmed for {{booking_ref}}. Parcel is being packed.',
    'parcel.repricing.sender':
      'IMPORTANT: Parcel weight differs from declared. New price: TZS {{new_price}} (+TZS {{difference}}). Accept or reject by {{deadline_time}}. Open FlexSend app to respond.',
    'parcel.repricing_accepted.sender':
      'Payment confirmed. Parcel {{booking_ref}} released for packing.',
    'parcel.repricing_rejected.sender':
      'Return initiated for {{booking_ref}}. We will return your parcel to you.',
    'parcel.courier_dispatched.sender':
      'Your parcel {{booking_ref}} is on its way to {{dest_city}}! Track it: flexsend.co.tz/track/{{booking_ref}}',
    'parcel.courier_dispatched.receiver':
      'Great news! A parcel for you is on its way from {{origin_city}}. ETA: {{eta_date}}.',
    'parcel.box_arrived.sender':
      'Your parcel {{booking_ref}} has arrived in {{dest_city}}.',
    'parcel.box_arrived.receiver':
      'Your parcel has arrived in {{city}} and will be delivered soon.',
    'parcel.last_mile_assigned.receiver':
      'Your parcel is out for delivery! Rider {{rider_name}} is on the way. ETA: {{eta}}. Be ready to receive.',
    'parcel.last_mile_assigned.sender':
      'Your parcel {{booking_ref}} is out for delivery to the receiver.',
    'parcel.delivered.sender':
      'Delivered! {{booking_ref}} was successfully delivered to the receiver. Thank you for using FlexSend!',
    'parcel.delivered.receiver':
      'Parcel received! Thank you for using FlexSend.',
    'parcel.delivered.agent':
      'Commission earned! {{booking_ref}} delivered. TZS {{commission_amount}} added to your balance.',
    'parcel.delivery_failed.receiver':
      'We could not deliver your parcel ({{booking_ref}}). Please respond by {{response_deadline}}: Reply RESCHEDULE or collect from {{office_name}}. After deadline parcel returns to sender.',
    'parcel.delivery_failed.sender':
      'Delivery of {{booking_ref}} failed after {{attempt_count}} attempts. Receiver notified.',
    'payment.confirmed.sender':
      'Payment of TZS {{amount}} confirmed for {{booking_ref}}. Balance due: TZS {{balance_due}}.',
    'payment.failed.sender':
      'Payment failed for {{booking_ref}}. Please try again.',
  };

  let template = templates[templateKey] || templateKey;
  for (const [key, value] of Object.entries(vars)) {
    template = template.replace(new RegExp(`{{${key}}}`, 'g'), value || '');
  }
  return template;
}