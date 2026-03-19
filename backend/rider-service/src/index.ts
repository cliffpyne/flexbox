import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import 'dotenv/config';
import { connectRedis } from './redis';
import riderRoutes   from './routes/riders';
import jobRoutes     from './routes/jobs';
import earningRoutes from './routes/earnings';
import webhookRoutes from './routes/webhooks';
import assignJobRoutes from './routes/assign-job';

const app = express();

app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json());

app.use('/riders', assignJobRoutes);


// ── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({
  status:    'ok',
  service:   'rider-service',
  port:      process.env.PORT || 3005,
  time:      new Date().toISOString(),
}));

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/riders',   riderRoutes);
app.use('/riders',   jobRoutes);
app.use('/riders',   earningRoutes);
app.use('/webhooks', webhookRoutes);

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('[rider-service] unhandled error:', err.message);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3005;
connectRedis().then(() => {
  app.listen(Number(PORT), '0.0.0.0', () =>
    console.log(`Rider Service running on port ${PORT}`)
  );
}).catch((err) => {
  console.error('Failed to connect Redis:', err.message);
  process.exit(1);
});