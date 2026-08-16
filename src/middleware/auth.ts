import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWTPayload } from '../types';
import { UserContext, Role } from '../utils/permissions';
import { PrismaClient } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
      userContext?: UserContext;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const prisma = new PrismaClient();

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}

export function generateJWT(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      status: 'error',
      message: 'Missing or invalid authorization header',
      timestamp: Date.now(),
    });
    return;
  }

  const token = authHeader.slice(7);
  const user = verifyToken(token);

  if (!user) {
    res.status(401).json({
      status: 'error',
      message: 'Invalid token',
      timestamp: Date.now(),
    });
    return;
  }

  req.user = user;

  // Build userContext from JWT payload (ownerId already included if applicable)
  let userContext: UserContext = {
    userId: user.userId,
    username: user.username,
    role: user.role as Role,
    ownerId: user.ownerId,
  };

  // Always load ownerId from database based on role and user
  try {
    const userRecord = await prisma.user.findUnique({
      where: { id: user.userId },
    });

    if (!userRecord) {
      res.status(401).json({
        status: 'error',
        message: 'User not found',
        timestamp: Date.now(),
      });
      return;
    }

    // Populate ownerId based on role
    if (userRecord.role === Role.OWNER) {
      const owner = await prisma.owner.findFirst({
        where: { userId: userRecord.id },
      });
      // Use owner's ownerId if they have one, otherwise use userId as fallback
      userContext.ownerId = owner?.id || user.userId;
    } else if (userRecord.role === Role.SELLER) {
      const seller = await prisma.seller.findFirst({
        where: { userId: userRecord.id },
      });
      // Use seller's ownerId or fallback to userId
      userContext.ownerId = seller?.ownerId || user.userId;
    } else if (userRecord.role === Role.GOD) {
      // Gods don't need an ownerId, use userId as fallback
      userContext.ownerId = user.userId;
    }
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Error loading user context',
      timestamp: Date.now(),
    });
    return;
  }

  req.userContext = userContext;
  next();
}

/**
 * Middleware for admin-level access
 * God, Owner, and Seller roles can access admin endpoints
 * Specific permission checks are done at the controller level
 */
export function adminMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.userContext) {
    res.status(401).json({
      status: 'error',
      message: 'Unauthorized',
      timestamp: Date.now(),
    });
    return;
  }

  const role = req.userContext.role;
  if (role !== Role.GOD && role !== Role.OWNER && role !== Role.SELLER) {
    res.status(403).json({
      status: 'error',
      message: 'Admin access required',
      timestamp: Date.now(),
    });
    return;
  }

  next();
}
