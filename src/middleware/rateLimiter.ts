import rateLimit from 'express-rate-limit';
import { Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      rateLimit?: {
        limit?: number;
        current?: number;
        remaining?: number;
        resetTime?: number;
      };
    }
  }
}

/**
 * General API rate limiter - 200 requests per minute per user
 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200, // limit each IP to 200 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req, res) => {
    // Skip rate limiting for health check
    return req.path === '/health';
  },
  handler: (req, res) => {
    res.status(429).json({
      status: 'error',
      message: 'Too many requests. Please try again later.',
      retryAfter: req.rateLimit?.resetTime,
      timestamp: Date.now(),
    });
  },
});

/**
 * Stricter rate limiter for authentication endpoints - 10 attempts per 15 minutes
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      status: 'error',
      message: 'Too many login attempts. Please try again in 15 minutes.',
      retryAfter: req.rateLimit?.resetTime,
      timestamp: Date.now(),
    });
  },
});

/**
 * Rate limiter for key generation - 50 keys per hour per user
 */
export const keyGenerationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // limit each user to 50 key generations per hour
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      status: 'error',
      message: 'Key generation rate limit exceeded. Try again in 1 hour.',
      retryAfter: req.rateLimit?.resetTime,
      timestamp: Date.now(),
    });
  },
});

/**
 * Rate limiter for file downloads - 100 downloads per hour per user
 */
export const downloadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100, // limit each user to 100 downloads per hour
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      status: 'error',
      message: 'Download rate limit exceeded. Try again in 1 hour.',
      retryAfter: req.rateLimit?.resetTime,
      timestamp: Date.now(),
    });
  },
});
