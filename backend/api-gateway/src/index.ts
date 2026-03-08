import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import http from 'http';
import 'dotenv/config';

import { connectRedis } from './redis';
import { requestLogger } from './middleware/requestLogger';
import { globalErrorHandler } from './middleware/errorHandler';
import {
  authenticate, authenticateDevice
} from './middleware/auth.middleware';
import {
  otpRateLimit, publicTrackingRateLimit, publicKeyRateLimit,
  standardRateLimit, bookingRateLimit, riderGpsRateLimit,
  authRateLimit, officeRateLimit, adminRateLimit
} from './middleware/rateLimiter';
import { circuitBreakerMiddleware } from './utils/circuitBreaker';
import { proxyTo } from './utils/proxy';
import { wsUpgradeHandler } from './utils/wsProxy';
import healthRouter from './routes/health';

const app = express();

// ── 1. Security headers ───────────────────────────────────────────────────────
app.use(helmet());

// ── 2. CORS ───────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, server-to-server, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  methods:        ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id', 'x-device-api-key'],
  exposedHeaders: ['x-request-id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  credentials:    true,
  maxAge:         86400,
}));

// ── 3. Request tracing + logging ──────────────────────────────────────────────
app.use(requestLogger);

// ── 4. Body parsing ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' })); // 10mb for base64 photo uploads

// ── 5. Health check — public, no auth ────────────────────────────────────────
app.use('/health', healthRouter);

// ── 6. Public routes — no JWT required ───────────────────────────────────────

// Auth — pre-auth endpoints
app.post('/auth/otp/request',
  authRateLimit,
  otpRateLimit,
  proxyTo('auth-service')
);
app.post('/auth/otp/verify',      authRateLimit, proxyTo('auth-service'));
app.post('/auth/pin/login',       authRateLimit, proxyTo('auth-service'));
app.post('/auth/password/login',  authRateLimit, proxyTo('auth-service'));
app.post('/auth/totp/verify',     authRateLimit, proxyTo('auth-service'));
app.post('/auth/refresh',         authRateLimit, proxyTo('auth-service'));

// Public parcel tracking — no auth, rate limited by IP
app.get('/parcels/track/:ref',
  publicTrackingRateLimit,
  proxyTo('parcel-service')
);

// Token public key — mobile apps fetch on first launch
app.get('/tokens/public-key',
  publicKeyRateLimit,
  proxyTo('token-service')
);

// Azam Pay payment webhook — HMAC verified inside payment-service
// Return 200 even on auth failure (payment-service handles it)
app.post('/payments/webhook/azampay', proxyTo('payment-service'));
app.post('/payments/webhook/*',       proxyTo('payment-service'));

// GPS device ping — device API key, not JWT
app.post('/tracking/gps/box',
  authenticateDevice,
  proxyTo('tracking-service')
);

// ── 7. Authenticated routes ───────────────────────────────────────────────────
const authed = express.Router();

// Every authenticated route: verify JWT first
authed.use(authenticate);

// Standard rate limit on all authenticated routes
// Per-user sliding window — 100 req/min
authed.use(standardRateLimit);

// Auth — name setup, profile
authed.use('/auth',
  circuitBreakerMiddleware('auth-service'),
  proxyTo('auth-service')
);

// Admin — staff creation, user management
authed.use('/admin',
  adminRateLimit,
  circuitBreakerMiddleware('auth-service'),
  proxyTo('auth-service')
);

// Parcels — booking + CRUD + events
// Booking POST has extra rate limit on top of standard
authed.post('/parcels',
  bookingRateLimit,
  circuitBreakerMiddleware('parcel-service'),
  proxyTo('parcel-service')
);
authed.use('/parcels',
  circuitBreakerMiddleware('parcel-service'),
  proxyTo('parcel-service')
);

// Routing
authed.use('/routes',
  circuitBreakerMiddleware('routing-service'),
  proxyTo('routing-service')
);

// Offices
authed.use('/offices',
  officeRateLimit,
  circuitBreakerMiddleware('office-service'),
  proxyTo('office-service')
);

// Riders
authed.use('/riders',
  circuitBreakerMiddleware('rider-service'),
  proxyTo('rider-service')
);

// Rider GPS — extra rate limit (1 ping per 5s = max 12/min)
authed.post('/tracking/gps/rider',
  riderGpsRateLimit,
  circuitBreakerMiddleware('tracking-service'),
  proxyTo('tracking-service')
);

// Tracking
authed.use('/tracking',
  circuitBreakerMiddleware('tracking-service'),
  proxyTo('tracking-service')
);

// Tokens — QR display and validation
authed.use('/tokens',
  circuitBreakerMiddleware('token-service'),
  proxyTo('token-service')
);

// Notifications — history
authed.use('/notifications',
  circuitBreakerMiddleware('notification-service'),
  proxyTo('notification-service')
);

// Payments — initiate, status, refunds, commissions
authed.use('/payments',
  circuitBreakerMiddleware('payment-service'),
  proxyTo('payment-service')
);

// Mount all authenticated routes
app.use(authed);

// ── 8. 404 handler ────────────────────────────────────────────────────────────
app.use((req: any, res) => {
  res.status(404).json({
    success: false,
    error: {
      code:    'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`
    }
  });
});

// ── 9. Global error handler — must be last ────────────────────────────────────
app.use(globalErrorHandler);

// ── 10. HTTP server — created manually for WebSocket upgrade support ──────────
const server = http.createServer(app);

// ── 11. WebSocket proxy — JWT verified before upgrade ─────────────────────────
server.on('upgrade', wsUpgradeHandler);

// ── 12. Start ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;

connectRedis().then(() => {
  server.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`[gateway] API Gateway running on port ${PORT}`);
    console.log(`[gateway] HTTP: http://0.0.0.0:${PORT}`);
    console.log(`[gateway] WS:   ws://0.0.0.0:${PORT}/ws/connect`);
  });
}).catch((err) => {
  console.error('[gateway] Startup failed:', err.message);
  process.exit(1);
});