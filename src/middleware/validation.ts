import { Request, Response, NextFunction } from 'express';
import { validationResult, body, param, query } from 'express-validator';
import { ApiError } from './errorHandler';

export function handleValidationErrors(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ApiError(400, errors.array()[0].msg);
  }
  next();
}

export const validateAuthRequest = [
  body('key').trim().notEmpty().withMessage('Key is required'),
  body('hwid').trim().notEmpty().withMessage('HWID is required'),
];

export const validateKeyGeneration = [
  body('key').trim().notEmpty().withMessage('Key is required'),
  body('cheatId').isInt().withMessage('Cheat ID must be an integer'),
  body('days').isInt({ min: 1 }).withMessage('Days must be a positive integer'),
];

export const validateCheatCreation = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('filename').trim().notEmpty().withMessage('Filename is required'),
  body('process').trim().notEmpty().withMessage('Process name is required'),
  body('injection').trim().notEmpty().withMessage('Injection method is required'),
  body('external').isBoolean().withMessage('External must be a boolean'),
];

export const validateLoggingRequest = [
  body('key').trim().notEmpty().withMessage('Key is required'),
  body('hwid').trim().notEmpty().withMessage('HWID is required'),
  body('message').trim().notEmpty().withMessage('Message is required'),
];
