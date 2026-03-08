import { Request, Response, NextFunction } from 'express';

interface ServiceState {
  state:         'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureCount:  number;
  lastFailureAt: number | null;
  nextRetryAt:   number | null;
}

const states = new Map<string, ServiceState>();

const FAILURE_THRESHOLD = 5;
const FAILURE_WINDOW_MS = 60000; // 60 seconds
const COOLDOWN_MS       = 30000; // 30 seconds before HALF_OPEN test

function getState(serviceName: string): ServiceState {
  return states.get(serviceName) ?? {
    state: 'CLOSED', failureCount: 0, lastFailureAt: null, nextRetryAt: null
  };
}

export const circuitBreaker = {
  isOpen(serviceName: string): boolean {
    const s = getState(serviceName);
    if (s.state === 'CLOSED') return false;

    if (s.state === 'OPEN') {
      if (Date.now() > (s.nextRetryAt ?? 0)) {
        // Cooldown expired — move to HALF_OPEN, let one test request through
        s.state = 'HALF_OPEN';
        states.set(serviceName, s);
        console.log(`[circuit] ${serviceName} → HALF_OPEN — testing recovery`);
        return false;
      }
      return true; // Still OPEN — block immediately
    }

    return false; // HALF_OPEN — let one through
  },

  recordFailure(serviceName: string) {
    const s = getState(serviceName);

    // Reset failure count if last failure was outside the window
    if (s.lastFailureAt && Date.now() - s.lastFailureAt > FAILURE_WINDOW_MS) {
      s.failureCount = 0;
    }

    s.failureCount++;
    s.lastFailureAt = Date.now();

    if (s.failureCount >= FAILURE_THRESHOLD) {
      s.state       = 'OPEN';
      s.nextRetryAt = Date.now() + COOLDOWN_MS;
      console.error(`[circuit] ${serviceName} → OPEN — ${s.failureCount} failures in window`);
    }

    states.set(serviceName, s);
  },

  recordSuccess(serviceName: string) {
    const s = getState(serviceName);
    if (s.state === 'HALF_OPEN') {
      console.log(`[circuit] ${serviceName} → CLOSED — recovery confirmed`);
    }
    states.set(serviceName, {
      state: 'CLOSED', failureCount: 0, lastFailureAt: null, nextRetryAt: null
    });
  },

  getStatus(): Record<string, ServiceState> {
    return Object.fromEntries(states);
  }
};

// Middleware — applied before every proxy call
export function circuitBreakerMiddleware(serviceName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (circuitBreaker.isOpen(serviceName)) {
      return res.status(503).json({
        success: false,
        error: {
          code:    'SERVICE_UNAVAILABLE',
          message: `Service temporarily unavailable. Please try again shortly.`
          // Never expose internal service name to client
        }
      });
    }
    next();
  };
}