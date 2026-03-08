import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import 'dotenv/config';
import { connectRedis } from './redis';
import tokenRoutes from './routes/tokens';

const app = express();
app.use(helmet()); app.use(cors({ origin: '*' })); app.use(express.json());

const publicKeyLimiter = rateLimit({ windowMs: 60000, max: 30 });
app.use('/tokens/public-key', publicKeyLimiter);
app.use('/tokens', tokenRoutes);

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'token-service', time: new Date().toISOString() }));

const PORT = process.env.PORT || 3007;
connectRedis().then(() => {
  app.listen(Number(PORT), '0.0.0.0', () => console.log(`Token Service running on port ${PORT}`));
});