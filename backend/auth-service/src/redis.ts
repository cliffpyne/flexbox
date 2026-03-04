import { createClient } from 'redis';
import 'dotenv/config';

export const redis = createClient({
  url: process.env.REDIS_URL // ← REPLACE IN .env
});

redis.on('error', (err) => console.error('Redis error:', err.message));

export async function connectRedis() {
  await redis.connect();
  console.log('Redis connected');
}
