import express from 'express';
import { Pool } from 'pg';
import axios from 'axios';
import crypto from 'crypto';
import cors from 'cors';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json());

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const MPESA_BASE = "https://openapi.m-pesa.com";
const API_KEY = process.env.MPESA_API_KEY!;
const PUBLIC_KEY = process.env.MPESA_PUBLIC_KEY!;
const SERVICE_PROVIDER_CODE = process.env.MPESA_SERVICE_PROVIDER_CODE!;
const CALLBACK_URL = process.env.MPESA_CALLBACK_URL!;

// Step 1 — Encrypt API key with RSA public key to get Session Key
function encryptApiKey(apiKey: string, publicKey: string): string {
  const buffer = Buffer.from(apiKey);
  const encrypted = crypto.publicEncrypt(
    {
      key: `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----`,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    buffer
  );
  return encrypted.toString('base64');
}

// Step 2 — Generate Session Key from M-Pesa
async function getSessionKey(): Promise<string> {
  const encryptedKey = encryptApiKey(API_KEY, PUBLIC_KEY);
  const { data } = await axios.get(
    `${MPESA_BASE}/sandbox/ipg/v2/vodacomTZN/getSession/`,
    {
      headers: {
        'Authorization': `Bearer ${encryptedKey}`,
        'Origin': '*',
        'Content-Type': 'application/json',
      },
    }
  );
  return data.output_SessionID;
}

// Step 3 — Make C2B payment using Session Key
async function c2bPayment(phone: string, amount: number, reference: string) {
  const sessionKey = await getSessionKey();
  const encryptedSession = encryptApiKey(sessionKey, PUBLIC_KEY);

  const { data } = await axios.post(
    `${MPESA_BASE}/sandbox/ipg/v2/vodacomTZN/c2bPayment/singleStage/`,
    {
      input_Amount: amount.toString(),
      input_Country: 'TZN',
      input_Currency: 'TZS',
      input_CustomerMSISDN: phone,
      input_ServiceProviderCode: SERVICE_PROVIDER_CODE,
      input_ThirdPartyConversationID: `flexbox-${Date.now()}`,
      input_TransactionReference: reference.substring(0, 20),
      input_PurchasedItemsDesc: 'Parcel Delivery Payment',
    },
    {
      headers: {
        'Authorization': `Bearer ${encryptedSession}`,
        'Origin': '*',
        'Content-Type': 'application/json',
      },
    }
  );
  return data;
}

// POST /initiate
app.post('/initiate', async (req: any, res) => {
  try {
    const { amount, phone, provider, bookingId } = req.body;
    if (provider === 'mpesa') {
      const mpesaRes = await c2bPayment(phone, amount, bookingId);
      const { rows } = await db.query(
        `INSERT INTO payments(booking_id, amount_tsh, phone, provider, mpesa_checkout_id, status)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [bookingId, amount, phone, provider, mpesaRes.output_ConversationID, 'pending']
      );
      res.json({
        success: true,
        data: {
          transactionId: rows[0].id,
          conversationId: mpesaRes.output_ConversationID,
          responseCode: mpesaRes.output_ResponseCode,
        }
      });
    } else {
      res.status(400).json({ success: false, message: "Unsupported provider" });
    }
  } catch (error: any) {
    console.error("Payment error:", error.response?.data || error.message);
    res.status(500).json({ success: false, message: "Payment failed" });
  }
});

// POST /callback — Vodacom Tanzania async callback
app.post('/callback', async (req: any, res) => {
  try {
    const {
      input_ResultCode,
      input_ResultDesc,
      input_OriginalConversationID,
      input_TransactionID,
      input_ThirdPartyConversationID,
    } = req.body;

    const status = input_ResultCode === 'INS-0' ? 'completed' : 'failed';

    await db.query(
      'UPDATE payments SET status=$1, completed_at=NOW() WHERE mpesa_checkout_id=$2',
      [status, input_OriginalConversationID]
    );

    if (status === 'completed') {
      const { rows } = await db.query(
        'SELECT booking_id FROM payments WHERE mpesa_checkout_id=$1',
        [input_OriginalConversationID]
      );
      if (rows[0]) {
        await db.query(
          'UPDATE parcels SET paid_at=NOW(), status=$1 WHERE id=$2',
          ['confirmed', rows[0].booking_id]
        );
      }
    }

    // Required response to close the session
    res.json({
      output_OriginalConversationID: input_OriginalConversationID,
      output_ResponseCode: '0',
      output_ResponseDesc: 'Successfully Accepted Result',
      output_ThirdPartyConversationID: input_ThirdPartyConversationID,
    });
  } catch (error) {
    console.error("Callback error:", error);
    res.status(500).json({ output_ResponseCode: '1', output_ResponseDesc: 'Failed' });
  }
});

// GET /:id/status
app.get('/:id/status', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM payments WHERE id=$1', [req.params.id]);
    rows[0]
      ? res.json({ success: true, data: rows[0] })
      : res.status(404).json({ success: false, message: "Not found" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal error" });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3005;
app.listen(PORT, () => console.log(`✅ Payment Service (Vodacom TZ) running on port ${PORT}`));