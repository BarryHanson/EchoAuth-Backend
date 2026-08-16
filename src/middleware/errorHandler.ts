import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { ApiResponse } from '../types';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function errorHandler(
  err: Error | ApiError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  const response: ApiResponse<null> = {
    status: 'error',
    message: err.message || 'Internal server error',
    timestamp: Date.now(),
  };

  if (err instanceof ApiError) {
    res.status(err.statusCode).json(response);
  } else {
    res.status(500).json(response);
  }
}
