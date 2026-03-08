import { Router } from 'express';
import { redis } from '../redis';
import { circuitBreaker } from '../utils/circuitBreaker';
import 'dotenv/config';

const router = Router();

const SERVICES = [
  { name: 'auth-service',          url: process.env.AUTH_SERVICE_URL         || 'http://auth-service:3001' },
  { name: 'parcel-service',        url: process.env.PARCEL_SERVICE_URL       || 'http://parcel-service:3002' },
  { name: 'routing-service',       url: process.env.ROUTING_SERVICE_URL      || 'http://routing-service:3003' },
  { name: 'office-service',        url: process.env.OFFICE_SERVICE_URL       || 'http://office-service:3004' },
  { name: 'rider-service',         url: process.env.RIDER_SERVICE_URL        || 'http://rider-service:3005' },
  { name: 'tracking-service',      url: process.env.TRACKING_SERVICE_URL     || 'http://tracking-service:3006' },
  { name: 'token-service',         url: process.env.TOKEN_SERVICE_URL        || 'http://token-service:3007' },
  { name: 'notification-service',  url: process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3008' },
  { name: 'payment-service',       url: process.env.PAYMENT_SERVICE_URL      || 'http://payment-service:3009' },
  { name: 'websocket-gateway',     url: process.env.WEBSOCKET_GATEWAY_URL?.replace('ws://', 'http://').replace('wss://', 'https://') || 'http://websocket-gateway:3012' },
];

// GET /health — full system health check
// Called by Railway every 30 seconds
router.get('/', async (req, res) => {
  const circuitStatuses = circuitBreaker.getStatus();

  const results = await Promise.allSettled(
    SERVICES.map(async (svc) => {
      const start = Date.now();
      try {
        const response = await fetch(`${svc.url}/health`, {
          signal: AbortSignal.timeout(3000)
        });
        return {
          name:       svc.name,
          status:     response.ok ? 'healthy' : 'degraded',
          latency_ms: Date.now() - start,
          circuit:    circuitStatuses[svc.name]?.state ?? 'CLOSED',
        };
      } catch {
        return {
          name:       svc.name,
          status:     'down',
          latency_ms: 3000,
          circuit:    circuitStatuses[svc.name]?.state ?? 'OPEN',
        };
      }
    })
  );

  const services = results.map((r, i) =>
    r.status === 'fulfilled' ? r.value :
    { name: SERVICES[i].name, status: 'down', latency_ms: 3000, circuit: 'OPEN' }
  );

  // Check gateway's own dependencies
  const redisOk = await redis.ping().then(() => true).catch(() => false);

  const allServicesHealthy = services.every(s => s.status === 'healthy');
  const overallStatus      = allServicesHealthy && redisOk ? 'healthy' : 'degraded';

  res.status(overallStatus === 'healthy' ? 200 : 503).json({
    status:     overallStatus,
    gateway:    'healthy',
    redis:      redisOk ? 'healthy' : 'down',
    services,
    checked_at: new Date().toISOString(),
    uptime_s:   Math.floor(process.uptime()),
  });
});

export default router;