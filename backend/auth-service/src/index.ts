import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import 'dotenv/config';

import { connectRedis } from './redis';
import otpRoutes      from './routes/otp';
import pinRoutes      from './routes/pin';
import passwordRoutes from './routes/password';
import adminRoutes    from './routes/admin';
import tokenRoutes    from './routes/token';

const app = express();

app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json());

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      20,
  message:  { success: false, message: 'Too many requests' }
});

app.use('/auth', authLimiter);

// Routes
app.use('/auth/otp',      otpRoutes);
app.use('/auth/pin',      pinRoutes);
app.use('/auth/password', passwordRoutes);
app.use('/auth',          tokenRoutes);
app.use('/admin',         adminRoutes);

app.get('/health', (_, res) => res.json({
  status:  'ok',
  service: 'auth-service',
  time:    new Date().toISOString()
}));

const PORT = process.env.PORT || 3001;

connectRedis().then(() => {
  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Auth Service running on port ${PORT}`);
  });
});
