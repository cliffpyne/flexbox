import { Pool } from 'pg';
import 'dotenv/config';

export const db = new Pool({
  connectionString: process.env.DATABASE_URL, // ← REPLACE IN .env
  ssl: { rejectUnauthorized: false }
});

db.on('error', (err) => console.error('Database error:', err.message));
