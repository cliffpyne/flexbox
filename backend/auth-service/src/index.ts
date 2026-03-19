import express    from 'express';
import cors       from 'cors';
import helmet     from 'helmet';
import rateLimit  from 'express-rate-limit';
import 'dotenv/config';

import { connectRedis }   from './redis';
import otpRoutes          from './routes/otp';
import pinRoutes          from './routes/pin';
import passwordRoutes     from './routes/password';
import adminRoutes        from './routes/admin';
import tokenRoutes        from './routes/token';
import usernameRoutes     from './routes/username';

const app = express();
app.set('trust proxy', 1); 

// ─── Security middleware ──────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin:      process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

// ─── Rate limiting ────────────────────────────────────────────────────────
// Tighter limit on auth endpoints — brute force protection
const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max:      100,
  message:  { success: false, message: 'Too many requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

app.use('/auth', authLimiter);

// ─── Routes ───────────────────────────────────────────────────────────────
app.use('/auth/otp',      otpRoutes);       // Customer OTP login
app.use('/auth/pin',      pinRoutes);       // Rider/office worker PIN login
app.use('/auth/password', passwordRoutes);  // Staff password login + change/forgot/reset
app.use('/auth/username', usernameRoutes);  // Change username
app.use('/auth',          tokenRoutes);     // Refresh, logout, me, public-key
app.use('/admin',         adminRoutes);     // Create users, deactivate, documents

// ─── Health check ─────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({
  status:  'ok',
  service: 'auth-service',
  time:    new Date().toISOString(),
}));

// ─── Global error handler ─────────────────────────────────────────────────
app.use((err: any, req: any, res: any, next: any) => {
  console.error('[auth-service error]', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

connectRedis().then(() => {
  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Auth Service running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to start auth service:', err);
  process.exit(1);
});
