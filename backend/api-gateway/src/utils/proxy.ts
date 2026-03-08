import { createProxyMiddleware } from 'http-proxy-middleware';
import { v4 as uuid } from 'uuid';
import { circuitBreaker } from './circuitBreaker';
import 'dotenv/config';

// Service URLs — read from env vars (Railway internal DNS)
function getServiceUrls(): Record<string, string> {
  return {
    'auth-service':          process.env.AUTH_SERVICE_URL         || 'http://auth-service:3001',
    'parcel-service':        process.env.PARCEL_SERVICE_URL       || 'http://parcel-service:3002',
    'routing-service':       process.env.ROUTING_SERVICE_URL      || 'http://routing-service:3003',
    'office-service':        process.env.OFFICE_SERVICE_URL       || 'http://office-service:3004',
    'rider-service':         process.env.RIDER_SERVICE_URL        || 'http://rider-service:3005',
    'tracking-service':      process.env.TRACKING_SERVICE_URL     || 'http://tracking-service:3006',
    'token-service':         process.env.TOKEN_SERVICE_URL        || 'http://token-service:3007',
    'notification-service':  process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3008',
    'payment-service':       process.env.PAYMENT_SERVICE_URL      || 'http://payment-service:3009',
  };
}

// Cache proxy instances — one per service
const proxyCache = new Map<string, any>();

export function proxyTo(serviceName: string) {
  if (proxyCache.has(serviceName)) return proxyCache.get(serviceName);

  const SERVICE_URLS = getServiceUrls();
  const target = SERVICE_URLS[serviceName];
  if (!target) throw new Error(`Unknown service: ${serviceName}`);

  const proxy = createProxyMiddleware({
    target,
    changeOrigin: true,
    proxyTimeout: 30000, // 30s — never hang indefinitely
    timeout:      30000,

    on: {
      proxyReq: (proxyReq: any, req: any) => {
        // Inject request tracing
        proxyReq.setHeader('x-request-id',   req.headers['x-request-id'] || uuid());
        proxyReq.setHeader('x-forwarded-for', req.ip || '');
        // Actor context headers already set by authenticate middleware
        // Authorization header already stripped by authenticate middleware
      },

      proxyRes: (proxyRes: any, req: any, res: any) => {
        if ((proxyRes.statusCode ?? 500) >= 500) {
          circuitBreaker.recordFailure(serviceName);
        } else {
          circuitBreaker.recordSuccess(serviceName);
        }
      },

      error: (err: any, req: any, res: any) => {
        circuitBreaker.recordFailure(serviceName);
        console.error(`[proxy] ${serviceName} error:`, err.message);

        if (!res.headersSent) {
          res.status(503).json({
            success: false,
            error: {
              code:    'SERVICE_UNAVAILABLE',
              message: 'Service temporarily unavailable. Please try again.'
              // Never expose internal URL or service name
            }
          });
        }
      }
    }
  });

  proxyCache.set(serviceName, proxy);
  return proxy;
}