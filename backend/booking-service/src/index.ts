import express from 'express';
import { Pool } from 'pg';
import { genTrackingNumber } from '@flexbox/utils';
import 'dotenv/config';

const app = express();
app.use(express.json());
const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{ rejectUnauthorized:false } });

const calculatePrice = (kg: number, from: string, to: string): number => {
  const base = 5000;
  const perKg = 1500;
  const isIntercity = from.toLowerCase() !== to.toLowerCase();
  return base + (kg * perKg) + (isIntercity ? 10000 : 0);
};

// POST /bookings — create a new parcel
app.post('/', async (req, res) => {
  try {
    const { senderId, receiverName, receiverPhone, originLat, originLng,
            originAddress, destLat, destLng, destAddress, weightKg } = req.body;

    const trackingNumber = genTrackingNumber();
    const priceTSH       = calculatePrice(weightKg, originAddress, destAddress);

    const { rows } = await db.query(`
      INSERT INTO parcels
        (tracking_number, sender_id, receiver_name, receiver_phone,
         origin_lat, origin_lng, origin_address,
         dest_lat,   dest_lng,   dest_address,
         weight_kg, price_tsh)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *
    `, [trackingNumber, senderId, receiverName, receiverPhone,
       originLat, originLng, originAddress,
       destLat, destLng, destAddress, weightKg, priceTSH]);

    res.json({ success:true, data:{ parcel:rows[0] } });
  } catch (error) {
    res.status(500).json({ success: false, error: "Booking failed" });
  }
});

// GET /track/:tracking — track by number
app.get('/track/:tracking', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM parcels WHERE tracking_number=$1', [req.params.tracking]);
  if (!rows[0]) return res.status(404).json({ success:false, message:"Parcel not found" });
  res.json({ success:true, data:rows[0] });
});

// GET /:id
app.get('/:id', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM parcels WHERE id=$1', [req.params.id]);
  res.json({ success:true, data:rows[0] });
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`Booking Service on port ${PORT}`));
