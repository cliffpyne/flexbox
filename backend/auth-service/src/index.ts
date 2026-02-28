import express from 'express';
import { Pool } from 'pg';
import { createClient } from 'redis';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import AfricasTalking from 'africastalking';
import 'dotenv/config';

const app = express();
app.use(express.json());

const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const redis = createClient({ 
  url: process.env.REDIS_URL,
  socket: {
    connectTimeout: 60000, // Increased to 60 seconds
    reconnectStrategy: (retries) => {
      console.log(`Redis reconnect attempt #${retries}`);
      return Math.min(retries * 500, 5000); // Wait longer between retries
    }
  }
});

redis.on('error', (err) => console.log('Redis Client Error:', err.message));
redis.connect().catch(err => console.log('Initial Redis Connection Failed, retrying in background...'));

const AT = AfricasTalking({ apiKey: process.env.AT_API_KEY!, username: process.env.AT_USERNAME! });

app.post('/login', async (req, res) => {
  const { phone, password } = req.body;
  const { rows } = await db.query('SELECT * FROM users WHERE phone=$1', [phone]);
  if (!rows[0]) return res.status(401).json({ success:false, message:"Invalid credentials" });
  const valid = await bcrypt.compare(password, rows[0].password_hash);
  if (!valid) return res.status(401).json({ success:false, message:"Invalid credentials" });
  const token = jwt.sign({ userId:rows[0].id, role:rows[0].role }, process.env.JWT_SECRET!, { expiresIn:'30d' });
  res.json({ success:true, data:{ token, user:{ id:rows[0].id, phone:rows[0].phone, role:rows[0].role } } });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`Auth Service on port ${PORT}`));
