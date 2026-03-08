import { Request, Response, NextFunction } from 'express';

export function globalErrorHandler(err: any, req: any, res: Response, next: NextFunction) {
  const requestId = req.headers['x-request-id'];

  console.error({
    requestId,
    route:   `${req.method} ${req.path}`,
    userId:  req.userId,
    error:   err.message,
    stack:   err.stack,
  });

  // Zod validation error
  if (err.name === 'ZodError') {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request data', details: err.errors }
    });
  }

  // CORS error
  if (err.message?.includes('not allowed by CORS')) {
    return res.status(403).json({
      success: false,
      error: { code: 'CORS_ERROR', message: 'Origin not allowed' }
    });
  }

  // Known operational error from downstream service
  if (err.isOperational) {
    return res.status(err.statusCode || 400).json({
      success: false,
      error: { code: err.code, message: err.message, field: err.field }
    });
  }

  // Unknown — never leak internals
  return res.status(500).json({
    success: false,
    error: {
      code:    'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
      details: { request_id: requestId }
    }
  });
}