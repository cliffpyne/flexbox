import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import 'dotenv/config';

import { connectRedis } from './redis';
import officeRoutes     from './routes/offices';
import geoRoutes        from './routes/geo';
import zoneRoutes       from './routes/zones';
import routeRoutes      from './routes/routes';
import boxRoutes        from './routes/boxes';
import operationsRoutes from './routes/operations';

const app = express();

app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────
// Geo routes MUST come before /:id routes to avoid conflicts
app.use('/offices',             geoRoutes);
app.use('/offices',             officeRoutes);
app.use('/offices/:id/zones',   zoneRoutes);
app.use('/offices/:id/routes',  routeRoutes);
app.use('/offices/boxes',       boxRoutes);
app.use('/offices/:id',         operationsRoutes);

app.get('/health', (_, res) => res.json({
  status:  'ok',
  service: 'office-service',
  time:    new Date().toISOString(),
}));

const PORT = process.env.PORT || 3004;

connectRedis().then(() => {
  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Office Service running on port ${PORT}`);
  });
});