import express from 'express';
import { Pool } from 'pg';
import cors from 'cors';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json());

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const authMiddleware = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ success: false, message: "No token" });
  req.user = { userId: "agent-id-from-jwt" }; // Replace with actual JWT decode
  next();
};

app.use(authMiddleware);

// GET /agents/dashboard
app.get('/dashboard', async (req: any, res) => {
  try {
    const agentId = req.user.userId;
    const { rows: agentRows } = await db.query('SELECT * FROM users WHERE id=$1', [agentId]);
    
    const { rows: statsRows } = await db.query(
      `SELECT COUNT(*) as today_parcels, SUM(price_tsh) as today_revenue, SUM(price_tsh * 0.05) as today_commission 
       FROM parcels WHERE agent_id=$1 AND created_at::date = CURRENT_DATE`,
      [agentId]
    );

    const { rows: parcels } = await db.query(
      `SELECT * FROM parcels WHERE agent_id=$1 AND created_at::date = CURRENT_DATE ORDER BY created_at DESC LIMIT 10`,
      [agentId]
    );

    res.json({
      success: true,
      data: {
        agent: agentRows[0],
        stats: {
          todayParcels: statsRows[0].today_parcels || 0,
          todayRevenue: statsRows[0].today_revenue || 0,
          todayCommission: statsRows[0].today_commission || 0,
        },
        todayParcels: parcels,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Internal error" });
  }
});

// POST /agents/bookings — Create single booking
app.post('/bookings', async (req: any, res) => {
  try {
    const agentId = req.user.userId;
    const {
      senderName, senderPhone, senderAddress,
      receiverName, receiverPhone, receiverAddress,
      originLat, originLng, destLat, destLng,
      weightKg
    } = req.body;

    const trackingNumber = `FBX${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
    const priceTSH = 5000 + (weightKg * 1500) + (senderAddress.toLowerCase() !== receiverAddress.toLowerCase() ? 10000 : 0);

    const { rows } = await db.query(
      `INSERT INTO parcels(tracking_number, agent_id, receiver_name, receiver_phone, origin_lat, origin_lng, origin_address, dest_lat, dest_lng, dest_address, weight_kg, price_tsh, status) 
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [trackingNumber, agentId, receiverName, receiverPhone, originLat, originLng, senderAddress, destLat, destLng, receiverAddress, weightKg, priceTSH, 'pending']
    );

    res.json({ success: true, data: { parcel: rows[0] } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Internal error" });
  }
});

// POST /agents/bookings/bulk
app.post('/bookings/bulk', async (req: any, res) => {
  try {
    const agentId = req.user.userId;
    const { parcels } = req.body;
    if (!Array.isArray(parcels) || parcels.length < 10 || parcels.length > 50) {
      return res.status(400).json({ success: false, message: "Bulk booking requires 10-50 parcels" });
    }
    const inserted = [];
    for (const p of parcels) {
      const trackingNumber = `FBX${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
      const priceTSH = 5000 + (p.weightKg * 1500);
      const { rows } = await db.query(
        `INSERT INTO parcels(tracking_number, agent_id, receiver_name, receiver_phone, origin_address, dest_address, weight_kg, price_tsh, status) 
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [trackingNumber, agentId, p.receiverName, p.receiverPhone, p.originAddress, p.destAddress, p.weightKg, priceTSH, 'pending']
      );
      inserted.push(rows[0]);
    }
    res.json({ success: true, data: { count: inserted.length, parcels: inserted } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Internal error" });
  }
});

// GET /agents/history
app.get('/history', async (req: any, res) => {
  try {
    const agentId = req.user.userId;
    const { rows } = await db.query('SELECT * FROM parcels WHERE agent_id=$1 ORDER BY created_at DESC LIMIT 100', [agentId]);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Internal error" });
  }
});

// GET /agents/earnings
app.get('/earnings', async (req: any, res) => {
  try {
    const agentId = req.user.userId;
    const { rows } = await db.query(
      `SELECT DATE(created_at) as date, COUNT(*) as parcels, SUM(price_tsh) as revenue, SUM(price_tsh * 0.05) as commission 
       FROM parcels WHERE agent_id=$1 AND created_at >= CURRENT_DATE - INTERVAL '30 days' GROUP BY DATE(created_at) ORDER BY date DESC`,
      [agentId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Internal error" });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3004;
app.listen(PORT, () => console.log(`✅ Agent Service running on port ${PORT}`));
