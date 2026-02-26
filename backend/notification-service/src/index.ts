import express from 'express';
import { Pool } from 'pg';
import admin from 'firebase-admin';
import { Receiver } from "@upstash/qstash";

import cors from 'cors';
import 'dotenv/config';

// Initialize Firebase Admin
if (process.env.FIREBASE_PROJECT_ID) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

const app = express();
app.use(cors());

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// QStash Security Receiver
const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
});

// WEBHOOK ENDPOINT (Replaces Kafka startKafkaConsumer)
// WEBHOOK ENDPOINT (Replaces Kafka startKafkaConsumer)
app.post("/webhook/notifications", express.json(), async (req: any, res) => {
  try {
    // Verify QStash signature manually
    const signature = req.headers["upstash-signature"] as string;
    const isValid = await receiver.verify({
      signature,
      body: JSON.stringify(req.body),
    });

    if (!isValid) {
      return res.status(401).send("Unauthorized");
    }

    const { topic, data } = req.body;
    console.log(`🔔 Notification Event: ${topic}`, data);

    let title = "Flexbox Update";
    let body = "You have a new update.";

    if (topic === "parcel.status.changed") {
      title = "Parcel Status Update";
      body = `Your parcel is now ${data.status}`;
    } else if (topic === "payment.completed") {
      title = "Payment Successful";
      body = `${data.amount} TSH received!`;
    } else if (topic === "task.assigned") {
      title = "New Task Assigned";
      body = `Pickup from ${data.origin}`;
    }

    await sendPushNotification(data.userId || data.riderId, { title, body });
    res.status(200).send("Notification Processed");
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(500).send("Internal Error");
  }
});

async function sendPushNotification(userId: string, payload: any) {
  try {
    const { rows } = await db.query('SELECT fcm_token FROM users WHERE id=$1', [userId]);
    if (rows[0]?.fcm_token) {
      await admin.messaging().send({
        token: rows[0].fcm_token,
        notification: { title: payload.title, body: payload.body },
      });
      console.log(`✅ Push sent to ${userId}`);
    }
  } catch (err) {
    console.error("❌ FCM Error:", err);
  }
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3006;
app.listen(PORT, () => console.log(`✅ Notification Service (QStash) on port ${PORT}`));
