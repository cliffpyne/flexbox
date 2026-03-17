import express      from 'express';
import cors         from 'cors';
import helmet       from 'helmet';
import rateLimit    from 'express-rate-limit';
import 'dotenv/config';

import { connectRedis }      from './redis';
import officeRoutes          from './routes/offices';
import geoRoutes             from './routes/geo';
import zoneRoutes            from './routes/zones';
import routeRoutes           from './routes/routes';
import boxRoutes             from './routes/boxes';
import operationsRoutes      from './routes/operations';
import pricingRoutes         from './routes/pricing';
import slaRoutes             from './routes/sla';
import staffRoutes           from './routes/staff';
import transporterRoutes     from './routes/transporter';

const app = express();

// Trust Railway / any reverse proxy
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
app.use(express.json({ limit: '2mb' }));

app.use(rateLimit({
  windowMs: 60_000, max: 300,
  message: { success: false, message: 'Too many requests' },
  standardHeaders: true, legacyHeaders: false,
}));

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE ORDER IS CRITICAL
// Static paths MUST be registered before dynamic /:id paths
// Otherwise Express treats "boxes" or "serving" as an office_id
// ─────────────────────────────────────────────────────────────────────────────
app.use('/offices',                   geoRoutes);         // /serving /nearest /coverage-check
app.use('/offices/boxes',             boxRoutes);         // /offices/boxes/*
app.use('/pricing',                   pricingRoutes);     // /pricing/*
app.use('/staff',                     staffRoutes);       // /staff/*
app.use('/offices',                   officeRoutes);      // /offices POST GET PATCH
app.use('/offices/:id/zones',         zoneRoutes);        // /offices/:id/zones/*
app.use('/offices/:id/routes',        routeRoutes);       // /offices/:id/routes/*
app.use('/offices/:id/sla',           slaRoutes);         // /offices/:id/sla/*
app.use('/offices/:id/transporter',   transporterRoutes); // /offices/:id/transporter/*
app.use('/offices/:id',               operationsRoutes);  // /offices/:id/* (queues, ops)

app.get('/health', (_, res) => res.json({
  status: 'ok', service: 'office-service', time: new Date().toISOString(),
}));

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('[office-service]', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

const PORT = process.env.PORT || 3004;
connectRedis().then(() => {
  app.listen(Number(PORT), '0.0.0.0', () =>
    console.log(`Office Service running on port ${PORT}`)
  );
}).catch(err => { console.error(err); process.exit(1); });
