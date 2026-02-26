import express from 'express';
import { Pool } from 'pg';
import { createClient } from 'redis';
import cors from 'cors';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json());

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const redis = createClient({ url: process.env.REDIS_URL });
redis.connect().catch(console.error);

const authMiddleware = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ success: false, message: "No token" });
  req.user = { userId: "rider-id-from-jwt" };
  next();
};

app.use(authMiddleware);

app.post('/status', async (req: any, res: any) => {
  try {
    const { isOnline, lat, lng } = req.body;
    const riderId = req.user.userId;
    await db.query(
      'UPDATE rider_profiles SET is_online=$1, current_lat=$2, current_lng=$3 WHERE user_id=$4',
      [isOnline, lat, lng, riderId]
    );
    if (isOnline) {
      await redis.sAdd('riders:online', riderId);
      await redis.set(`rider:data:${riderId}`, JSON.stringify({
        id: riderId, lat, lng, tasks: 0, rating: 5.0, successRate: 1.0,
        vehicle: 'motorcycle', territories: {}
      }), { EX: 3600 });
    } else {
      await redis.sRem('riders:online', riderId);
      await redis.del(`rider:data:${riderId}`);
    }
    res.json({ success: true, data: { isOnline } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Internal error" });
  }
});

app.get('/tasks/active', async (req: any, res: any) => {
  try {
    const riderId = req.user.userId;
    const { rows } = await db.query(
      'SELECT * FROM parcels WHERE rider_id=$1 AND status IN ($2,$3,$4)',
      [riderId, 'pickup_assigned', 'picked_up', 'in_transit']
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Internal error" });
  }
});

app.post('/tasks/:id/pickup-confirm', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    await db.query(
      'UPDATE parcels SET status=$1, pickup_confirmed_at=NOW() WHERE id=$2',
      ['picked_up', id]
    );
    res.json({ success: true, message: "Pickup confirmed" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Internal error" });
  }
});

app.post('/tasks/:id/delivery-confirm', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const riderId = req.user.userId;
    await db.query(
      'UPDATE parcels SET status=$1, completed_at=NOW() WHERE id=$2',
      ['delivered', id]
    );
    await db.query(
      'INSERT INTO earnings(rider_id, parcel_id, amount_tsh, type) VALUES($1,$2,$3,$4)',
      [riderId, id, 5000, 'delivery']
    );
    res.json({ success: true, message: "Delivery confirmed" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Internal error" });
  }
});

app.post('/tasks/:id/delivery-failed', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    await db.query(
      'UPDATE parcels SET status=$1, failed_at=NOW() WHERE id=$2',
      ['failed_delivery', id]
    );
    res.json({ success: true, message: "Delivery marked as failed" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Internal error" });
  }
});

app.get('/earnings', async (req: any, res: any) => {
  try {
    const riderId = req.user.userId;
    const { rows } = await db.query(
      'SELECT SUM(amount_tsh) as total, COUNT(*) as count FROM earnings WHERE rider_id=$1 AND is_paid_out=false',
      [riderId]
    );
    res.json({ success: true, data: { totalTSH: rows[0].total || 0, count: rows[0].count || 0 } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Internal error" });
  }
});

app.post('/earnings/withdraw', async (req: any, res: any) => {
  try {
    const riderId = req.user.userId;
    await db.query(
      'UPDATE earnings SET is_paid_out=true, paid_out_at=NOW() WHERE rider_id=$1 AND is_paid_out=false',
      [riderId]
    );
    res.json({ success: true, message: "Withdrawal initiated" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Internal error" });
  }
});

app.patch('/location', async (req: any, res: any) => {
  try {
    const { lat, lng } = req.body;
    const riderId = req.user.userId;
    await db.query(
      'UPDATE rider_profiles SET current_lat=$1, current_lng=$2 WHERE user_id=$3',
      [lat, lng, riderId]
    );
    await redis.hSet(`rider:location:${riderId}`, {
      lat: lat.toString(),
      lng: lng.toString(),
      timestamp: Date.now().toString(),
    });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Internal error" });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => console.log(`✅ Rider Service running on port ${PORT}`));