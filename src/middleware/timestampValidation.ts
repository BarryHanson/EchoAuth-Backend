import { Request, Response, NextFunction } from 'express';
import { AntiTamperingService } from '../services/AntiTamperingService';
import { ApiError } from './errorHandler';
import { logger } from '../utils/logger';

/**
 * Middleware to validate session timestamps and detect clock tampering
 * Only applies to authenticated JWT requests
 */
export const timestampValidationMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Only validate if user is authenticated via JWT
    if (req.user && req.user.userId) {
      const isValid = await AntiTamperingService.validateSessionTimestamp(req.user.userId);

      if (!isValid) {
        logger.warn('Timestamp validation failed - possible clock tampering', {
          userId: req.user.userId,
          path: req.path,
          method: req.method,
        });

        throw new ApiError(403, 'Suspicious activity detected: System clock tampering suspected. Session invalidated.');
      }
    }

    next();
  } catch (error) {
    next(error);
  }
};
