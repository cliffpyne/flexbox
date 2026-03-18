import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import 'dotenv/config';

import { connectRedis } from './redis';
import parcelRoutes      from './routes/parcels';
import eventRoutes       from './routes/events';
import measurementRoutes from './routes/measurement';
import returnRoutes      from './routes/returns';

const app = express();
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json());

// Public tracking — rate limit by IP
const trackingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      10,
  message:  { success: false, message: 'Too many tracking requests' }
});

app.use('/parcels/track', trackingLimiter);

// Routes
app.use('/parcels',                     parcelRoutes);
app.use('/parcels/:id/events',          eventRoutes);
app.use('/parcels/:id/events/batch-sync', eventRoutes);
app.use('/parcels/:id/measurement',     measurementRoutes);
app.use('/parcels/:id/return',          returnRoutes);

app.get('/health', (_, res) => res.json({
  status:  'ok',
  service: 'parcel-service',
  time:    new Date().toISOString(),
}));

const PORT = process.env.PORT || 3002;

connectRedis().then(() => {
  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Parcel Service running on port ${PORT}`);
  });
});