import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import 'dotenv/config';
import { connectRedis } from './redis';
import trackingRoutes from './routes/tracking';

const app = express();
app.use(helmet()); app.use(cors({ origin: '*' })); app.use(express.json());
app.use('/tracking', trackingRoutes);
app.get('/health', (_, res) => res.json({ status: 'ok', service: 'tracking-service', time: new Date().toISOString() }));

const PORT = process.env.PORT || 3006;
connectRedis().then(() => {
  app.listen(Number(PORT), '0.0.0.0', () => console.log(`Tracking Service running on port ${PORT}`));
});