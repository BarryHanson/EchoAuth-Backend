import { Request, Response, NextFunction } from 'express';
import { createHmac } from 'crypto';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const DEFAULT_SECRET = 'default-secret-change-in-production';
const secretCache = new Map<number, { secret: string; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get the appropriate API secret for request signing
 * Uses the owner's API secret if authenticated, otherwise uses default
 */
async function getApiSecret(req: Request): Promise<string> {
  try {
    let ownerId: number | undefined;

    // Try to get owner from auth context
    if ((req as any).user && (req as any).user.ownerId) {
      ownerId = (req as any).user.ownerId;
    }

    // Try to extract from JWT token if present
    if (!ownerId) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const decoded = jwt.decode(token) as any;
        if (decoded && decoded.ownerId) {
          ownerId = decoded.ownerId;
        }
      }
    }

    if (ownerId) {
      // Check cache first
      const cached = secretCache.get(ownerId);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.secret;
      }

      // Fetch from database
      const owner = await prisma.owner.findUnique({
        where: { id: ownerId },
        select: { apiSecret: true }
      });

      if (owner?.apiSecret) {
        secretCache.set(ownerId, { secret: owner.apiSecret, timestamp: Date.now() });
        return owner.apiSecret;
      }
    }
  } catch (error) {
    // Fall through to default
  }

  return DEFAULT_SECRET;
}

/**
 * Middleware to sign all API responses with HMAC-SHA256
 * Uses the owner's API secret if authenticated, otherwise uses default
 * This allows clients to verify response authenticity and detect tampering
 */
export function signResponse(req: Request, res: Response, next: NextFunction) {
  // Store the original json method
  const originalJson = res.json.bind(res);

  // Override the json method to sign responses
  res.json = function (data: any) {
    // Wrap the signing in an async IIFE to handle async operations without making res.json async
    getApiSecret(req).then((apiSecret) => {
      // Convert response body to string
      const responseBody = JSON.stringify(data);

      // Generate HMAC-SHA256 signature
      const signature = createHmac('sha256', apiSecret)
        .update(responseBody)
        .digest('hex');

      // Add signature header
      res.setHeader('X-Signature', signature);
      res.setHeader('Access-Control-Expose-Headers', 'X-Signature');

      // Call original json method
      return originalJson(data);
    }).catch((error) => {
      // If signature generation fails, still send response with default secret
      const responseBody = JSON.stringify(data);
      const signature = createHmac('sha256', DEFAULT_SECRET)
        .update(responseBody)
        .digest('hex');
      res.setHeader('X-Signature', signature);
      res.setHeader('Access-Control-Expose-Headers', 'X-Signature');
      return originalJson(data);
    });

    // Return the response object for chaining
    return res;
  };

  next();
}

/**
 * Verify response signature (for testing/client-side validation)
 */
export function verifySignature(responseBody: string, signature: string, apiSecret?: string): boolean {
  const secret = apiSecret || DEFAULT_SECRET;
  const expectedSignature = createHmac('sha256', secret)
    .update(responseBody)
    .digest('hex');

  return signature === expectedSignature;
}
