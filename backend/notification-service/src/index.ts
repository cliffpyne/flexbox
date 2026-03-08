import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import 'dotenv/config';
import { connectRedis } from './redis';
import webhookRoutes from './routes/webhooks';
import notificationRoutes from './routes/notifications';

const app = express();
app.use(helmet()); app.use(cors({ origin: '*' })); app.use(express.json());

app.use('/webhooks', webhookRoutes);
app.use('/notifications', notificationRoutes);
app.get('/health', (_, res) => res.json({ status: 'ok', service: 'notification-service', time: new Date().toISOString() }));

const PORT = process.env.PORT || 3008;
connectRedis().then(() => {
  app.listen(Number(PORT), '0.0.0.0', () => console.log(`Notification Service running on port ${PORT}`));
});