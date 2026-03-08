import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import 'dotenv/config';
import { connectRedis } from './redis';
import paymentRoutes from './routes/payments';

const app = express();
app.use(helmet()); app.use(cors({ origin: '*' })); app.use(express.json());

// Rate limiting on payment initiation
const paymentLimiter = rateLimit({ windowMs: 60000, max: 10, message: 'Too many payment requests' });
app.use('/payments/initiate', paymentLimiter);

app.use('/payments', paymentRoutes);
app.get('/health', (_, res) => res.json({ status: 'ok', service: 'payment-service', time: new Date().toISOString() }));

const PORT = process.env.PORT || 3009;
connectRedis().then(() => {
  app.listen(Number(PORT), '0.0.0.0', () => console.log(`Payment Service running on port ${PORT}`));
});