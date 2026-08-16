import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { userSubscriptionService } from '../services/UserSubscriptionService';
import { ApiError } from '../middleware/errorHandler';
import { ApiResponse } from '../types';

const prisma = new PrismaClient();

export class UserSubscriptionController {
  /**
   * User views their active subscription
   */
  async getMySubscription(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      if (req.userContext.role !== 'user') {
        throw new ApiError(403, 'Forbidden: This endpoint is for users only');
      }

      const subscription = await userSubscriptionService.getUserSubscription(req.userContext.userId);

      const response: ApiResponse<any> = {
        status: 'success',
        data: subscription,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Owner views all users under their program
   */
  async getProgramUsers(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const ownerId = parseInt(req.params.ownerId);

      if (!ownerId) {
        res.status(400).json({
          status: 'error',
          message: 'ownerId is required',
          timestamp: Date.now(),
        });
        return;
      }

      // Only owner or god can view users for a program
      if (req.userContext.role === 'owner') {
        const ownerRecord = await prisma.owner.findUnique({
          where: { id: ownerId },
        });
        if (!ownerRecord || ownerRecord.userId !== req.userContext.userId) {
          throw new ApiError(403, 'Forbidden: Cannot view users for this program');
        }
      } else if (req.userContext.role === 'seller') {
        throw new ApiError(403, 'Forbidden: Sellers cannot view user list');
      }

      const users = await userSubscriptionService.getOwnerUsers(ownerId);

      const response: ApiResponse<any> = {
        status: 'success',
        data: users,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Owner revokes a user's subscription
   */
  async revokeUserSubscription(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const { ownerId, userKeyId } = req.body;

      if (!ownerId || !userKeyId) {
        res.status(400).json({
          status: 'error',
          message: 'ownerId and userKeyId are required',
          timestamp: Date.now(),
        });
        return;
      }

      // Only owner or god can revoke
      if (req.userContext.role === 'owner' && req.userContext.ownerId !== ownerId) {
        throw new ApiError(403, 'Forbidden: Cannot revoke subscriptions for this program');
      } else if (req.userContext.role === 'seller') {
        throw new ApiError(403, 'Forbidden: Sellers cannot revoke subscriptions');
      }

      await userSubscriptionService.revokeUserSubscription(userKeyId, ownerId);

      const response: ApiResponse<null> = {
        status: 'success',
        message: 'User subscription revoked',
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * User activates their subscription
   */
  async activateSubscription(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      if (req.userContext.role !== 'user') {
        throw new ApiError(403, 'Forbidden: This endpoint is for users only');
      }

      const subscription = await userSubscriptionService.activateSubscription(req.userContext.userId);

      const response: ApiResponse<any> = {
        status: 'success',
        message: 'Subscription activated successfully',
        data: subscription,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * User resets their HWID binding (24-hour cooldown)
   */
  async resetHwid(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      if (req.userContext.role !== 'user') {
        throw new ApiError(403, 'Forbidden: This endpoint is for users only');
      }

      await userSubscriptionService.resetHwid(req.userContext.userId);

      const response: ApiResponse<null> = {
        status: 'success',
        message: 'HWID reset successfully. Your next reset will be available in 24 hours.',
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * User resets their IP binding (24-hour cooldown)
   */
  async resetIp(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      if (req.userContext.role !== 'user') {
        throw new ApiError(403, 'Forbidden: This endpoint is for users only');
      }

      await userSubscriptionService.resetIp(req.userContext.userId);

      const response: ApiResponse<null> = {
        status: 'success',
        message: 'IP reset successfully. Your next reset will be available in 24 hours.',
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Replace current key with a new key
   * User can do this when their current key expires
   */
  async replaceKey(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const { newKeyValue } = req.body;

      if (!newKeyValue) {
        throw new ApiError(400, 'New key value is required');
      }

      // Get current subscription
      const currentUserKey = await prisma.userKey.findUnique({
        where: { userId: req.userContext.userId },
        include: { key: true },
      });

      if (!currentUserKey) {
        throw new ApiError(404, 'No active subscription found');
      }

      // Find the new key
      const newKey = await prisma.key.findUnique({
        where: { key: newKeyValue },
      });

      if (!newKey) {
        throw new ApiError(404, 'Key not found');
      }

      if (newKey.ownerId !== currentUserKey.ownerId) {
        throw new ApiError(400, 'Key does not belong to this program');
      }

      if (newKey.status !== 'waiting') {
        throw new ApiError(400, 'Key is not available for registration');
      }

      // Check if key is already linked to another user
      const existingUserKey = await prisma.userKey.findUnique({
        where: { keyId: newKey.id },
      });

      if (existingUserKey) {
        throw new ApiError(400, 'This key is already linked to another account');
      }

      // Update the user key to point to the new key
      await prisma.userKey.update({
        where: { id: currentUserKey.id },
        data: {
          keyId: newKey.id,
          activatedAt: null, // Reset activation so user must activate again
          expiresAt: null,
          lastHwidReset: null,
          lastIpReset: null,
        },
      });

      const response: ApiResponse<null> = {
        status: 'success',
        message: 'Key replaced successfully. Click Activate to start your new subscription.',
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }
}

export const userSubscriptionController = new UserSubscriptionController();
