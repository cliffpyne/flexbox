import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app = express();

app.use(helmet());
app.use(cors({ origin: '*' }));   // Tighten in production
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 20,  message: "Too many requests" });
const apiLimiter  = rateLimit({ windowMs: 60*1000,    max: 200, message: "Too many requests" });

app.use('/api/auth', authLimiter);
app.use('/api',      apiLimiter);

// Proxy to services
const proxy = (target: string) => createProxyMiddleware({ 
  target, 
  changeOrigin: true,
  pathRewrite: { '^/api': '' } // Optional: removes /api prefix before sending to microservices
});

app.use('/api/auth',          proxy(process.env.AUTH_SERVICE_URL    || 'http://localhost:3001'));
app.use('/api/bookings',      proxy(process.env.BOOKING_SERVICE_URL || 'http://localhost:3002'));
app.use('/api/riders',        proxy(process.env.RIDER_SERVICE_URL   || 'http://localhost:3003'));
app.use('/api/agents',        proxy(process.env.AGENT_SERVICE_URL   || 'http://localhost:3004'));
app.use('/api/payments',      proxy(process.env.PAYMENT_SERVICE_URL || 'http://localhost:3005'));
app.use('/api/dispatch',      proxy(process.env.DISPATCH_URL        || 'http://localhost:8000'));
app.use('/api/notifications', proxy(process.env.NOTIFY_URL          || 'http://localhost:3006'));

app.get('/health', (_, res) => res.json({ status: 'ok', timestamp: new Date() }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API Gateway running on port ${PORT}`));
