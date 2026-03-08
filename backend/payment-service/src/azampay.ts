import crypto from 'crypto';
import 'dotenv/config';

// ── Valid state transitions ──────────────────────────────────────────────────
const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING:    ['PROCESSING'],
  PROCESSING: ['CONFIRMED', 'FAILED'],
  CONFIRMED:  ['REFUNDED'],
  FAILED:     [],      // Retry = new payment record with new idempotency_key
  REFUNDED:   [],
  CANCELLED:  [],
};

export function isValidTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Azam Pay STK push ─────────────────────────────────────────────────────────
export async function initiateAzamPaySTK(params: {
  amount: number;
  phone_number: string;
  idempotency_key: string;
  description: string;
  provider: string;
}): Promise<{ success: boolean; provider_ref?: string; error?: string }> {
  const azamUrl = process.env.AZAMPAY_BASE_URL;
  const apiKey  = process.env.AZAMPAY_API_KEY;

  if (!azamUrl || !apiKey) {
    // Dev mode — simulate success
    console.log(`[PAY DEV] STK push to ${params.phone_number}: TZS ${params.amount} — ${params.description}`);
    return { success: true, provider_ref: `DEV-${crypto.randomUUID().slice(0,8).toUpperCase()}` };
  }

  try {
    const response = await fetch(`${azamUrl}/api/v1/checkout/mobile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({
        accountNumber: params.phone_number.replace('+', ''),
        amount:        params.amount.toString(),
        currency:      'TZS',
        externalId:    params.idempotency_key,
        provider:      mapProviderCode(params.provider),
        remarks:       params.description,
      }),
    });

    const data = await response.json();
    if (response.ok && data.success) {
      return { success: true, provider_ref: data.transactionId };
    }
    return { success: false, error: data.message || 'STK push failed' };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ── Azam Pay refund ───────────────────────────────────────────────────────────
export async function initiateAzamPayRefund(params: {
  original_provider_ref: string;
  amount: number;
  phone_number: string;
}): Promise<{ success: boolean; refund_ref?: string; error?: string }> {
  const azamUrl = process.env.AZAMPAY_BASE_URL;
  const apiKey  = process.env.AZAMPAY_API_KEY;

  if (!azamUrl || !apiKey) {
    console.log(`[PAY DEV] Refund to ${params.phone_number}: TZS ${params.amount}`);
    return { success: true, refund_ref: `REFUND-DEV-${crypto.randomUUID().slice(0,8).toUpperCase()}` };
  }

  try {
    const response = await fetch(`${azamUrl}/api/v1/disbursement/mobile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({
        accountNumber: params.phone_number.replace('+', ''),
        amount:        params.amount.toString(),
        currency:      'TZS',
        remarks:       `Refund for ${params.original_provider_ref}`,
      }),
    });
    const data = await response.json();
    return data.success
      ? { success: true, refund_ref: data.transactionId }
      : { success: false, error: data.message };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ── HMAC signature verification ───────────────────────────────────────────────
export function verifyAzamPaySignature(payload: object, signature: string): boolean {
  const secret   = process.env.AZAMPAY_WEBHOOK_SECRET;
  if (!secret) return true; // Dev mode — skip verification
  const body     = JSON.stringify(payload);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature)); }
  catch { return false; }
}

// ── Provider code mapping ─────────────────────────────────────────────────────
function mapProviderCode(provider: string): string {
  const map: Record<string, string> = {
    MPESA:       'Mpesa',
    TIGO_PESA:   'Tigo',
    AIRTEL_MONEY:'Airtel',
    HALOPESA:    'Halopesa',
  };
  return map[provider] || provider;
}

// ── Commission rates ──────────────────────────────────────────────────────────
export const AGENT_COMMISSION_RATE = 0.05;  // 5% default
export const RIDER_BASE_EARNINGS: Record<string, number> = {
  PICKUP:          1500,
  DELIVERY:        2000,
  INTERCITY:       3000,
  COURIER_DROPOFF: 1000,
};