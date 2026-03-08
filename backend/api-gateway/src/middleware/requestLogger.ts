import { Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';

export function requestLogger(req: any, res: Response, next: NextFunction) {
  const requestId = (req.headers['x-request-id'] as string) || uuid();
  const startTime = Date.now();

  // Inject request ID into headers — flows to all downstream services
  req.headers['x-request-id'] = requestId;
  res.setHeader('x-request-id', requestId);

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const log = {
      timestamp:   new Date().toISOString(),
      request_id:  requestId,
      method:      req.method,
      path:        req.path,
      status:      res.statusCode,
      duration_ms: duration,
      user_id:     req.userId    ?? 'anonymous',
      user_role:   req.userRole  ?? 'none',
      ip:          req.ip,
      user_agent:  req.headers['user-agent'],
    };
    // Log bodies NEVER — may contain PII, tokens, OTPs, payment data
    if (res.statusCode >= 500) {
      console.error('[gateway]', JSON.stringify(log));
    } else if (res.statusCode >= 400) {
      console.warn('[gateway]',  JSON.stringify(log));
    } else {
      console.log('[gateway]',   JSON.stringify(log));
    }
  });

  next();
}