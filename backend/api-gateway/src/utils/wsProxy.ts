import { createProxyMiddleware } from 'http-proxy-middleware';
import jwt from 'jsonwebtoken';
import 'dotenv/config';

const WS_TARGET = process.env.WEBSOCKET_GATEWAY_URL || 'ws://websocket-gateway:3012';

// WebSocket proxy instance — reused for all upgrades
export const wsProxy = createProxyMiddleware({
  target:      WS_TARGET,
  ws:          true,
  changeOrigin: true,
});

// Upgrade handler — attached to raw http.Server, not Express
// Must run BEFORE proxying — verifies JWT and injects actor headers
export async function wsUpgradeHandler(req: any, socket: any, head: any) {
  try {
    // Extract token from query string or Authorization header
    const url   = new URL(req.url!, `http://${req.headers.host}`);
    const token = url.searchParams.get('token') ||
                  req.headers['authorization']?.split(' ')[1];

    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Verify JWT
    const secret  = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET || '';
    const payload: any = jwt.verify(token, secret);

    // Inject actor context into upgrade request headers
    // WebSocket Gateway reads these on connection
    req.headers['x-user-id']    = payload.user_id;
    req.headers['x-user-role']  = payload.role;
    req.headers['x-office-id']  = payload.office_id ?? '';
    req.headers['x-actor-type'] = payload.actor_type ?? '';

    // Remove raw token from query — don't forward credentials downstream
    url.searchParams.delete('token');
    req.url = url.pathname + (url.search || '');

    // Forward the upgraded connection to WebSocket Gateway
    (wsProxy as any).upgrade(req, socket, head);

  } catch (err: any) {
    console.error('[gateway] WS auth failed:', err.message);
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
  }
}