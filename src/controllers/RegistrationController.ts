import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { registrationService } from '../services/RegistrationService';
import { userSubscriptionService } from '../services/UserSubscriptionService';
import { authService } from '../services/AuthService';
import { PermissionChecker } from '../utils/permissions';
import { ApiError } from '../middleware/errorHandler';
import { ApiResponse } from '../types';

const prisma = new PrismaClient();

export class RegistrationController {
  /**
   * Owner generates a user registration token for a key
   */
  async generateUserToken(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const { keyId, ownerId: bodyOwnerId } = req.body;
      const ownerId = bodyOwnerId || req.userContext.ownerId;

      if (!ownerId) {
        throw new ApiError(400, 'No ownerId in context. You must be an owner or seller.');
      }

      // Check permission
      if (!PermissionChecker.canManageSellers(req.userContext) ||
          (req.userContext.role === 'owner' && req.userContext.ownerId !== ownerId)) {
        throw new ApiError(403, 'Forbidden: Cannot generate tokens for this owner');
      }

      // keyId is optional - users can enter their key during registration
      const { token, id } = await registrationService.generateToken(ownerId, 'user', keyId);

      const response: ApiResponse<any> = {
        status: 'success',
        data: {
          id,
          token,
          type: 'user',
          registrationLink: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/register/${req.userContext.username}?token=${token}`,
        },
        timestamp: Date.now(),
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Owner generates a seller registration token
   */
  async generateSellerToken(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const { ownerId: bodyOwnerId, maxKeysLimit } = req.body;
      const ownerId = bodyOwnerId || req.userContext.ownerId;

      if (!ownerId) {
        throw new ApiError(400, 'No ownerId in context. You must be an owner or seller.');
      }

      // Check permission - need to verify owner actually belongs to this user
      if (!PermissionChecker.canManageSellers(req.userContext)) {
        throw new ApiError(403, 'Forbidden: Cannot generate tokens');
      }

      // For owners, verify they own this specific program
      if (req.userContext.role === 'owner') {
        const owner = await prisma.owner.findUnique({
          where: { id: ownerId },
        });
        if (!owner || owner.userId !== req.userContext.userId) {
          throw new ApiError(403, 'Forbidden: You do not own this program');
        }
      }

      const { token, id } = await registrationService.generateToken(
        ownerId,
        'seller',
        undefined,
        maxKeysLimit
      );

      const response: ApiResponse<any> = {
        status: 'success',
        data: {
          id,
          token,
          type: 'seller',
          maxKeysLimit: maxKeysLimit || 100,
          registrationLink: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/register/seller?token=${token}`,
        },
        timestamp: Date.now(),
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get registration tokens for an owner
   */
  async getOwnerTokens(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const ownerId = parseInt(req.params.ownerId);
      const type = (req.query.type as 'user' | 'seller' | undefined);

      if (!ownerId) {
        res.status(400).json({
          status: 'error',
          message: 'ownerId is required',
          timestamp: Date.now(),
        });
        return;
      }

      // Check permission
      if (!PermissionChecker.canManageSellers(req.userContext) ||
          (req.userContext.role === 'owner' && req.userContext.ownerId !== ownerId)) {
        throw new ApiError(403, 'Forbidden: Cannot view tokens for this owner');
      }

      const tokens = await registrationService.getOwnerTokens(ownerId, type);

      const response: ApiResponse<any> = {
        status: 'success',
        data: tokens,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get registration token details (public endpoint for signup forms)
   */
  async getTokenInfo(req: Request, res: Response, next: NextFunction) {
    try {
      const { token } = req.query;

      if (!token || typeof token !== 'string') {
        throw new ApiError(400, 'Token is required');
      }

      const tokenInfo = await registrationService.getTokenDetails(token);

      const response: ApiResponse<any> = {
        status: 'success',
        data: {
          type: tokenInfo.type,
          owner: tokenInfo.owner,
          key: tokenInfo.type === 'user' ? tokenInfo.key : undefined,
          maxKeysLimit: tokenInfo.type === 'seller' ? tokenInfo.maxKeysLimit : undefined,
        },
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete a registration token
   */
  async deleteToken(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const { ownerId: bodyOwnerId, tokenId } = req.body;
      const ownerId = bodyOwnerId || req.userContext.ownerId;

      if (!tokenId) {
        res.status(400).json({
          status: 'error',
          message: 'tokenId is required',
          timestamp: Date.now(),
        });
        return;
      }

      if (!ownerId) {
        throw new ApiError(400, 'No ownerId in context. You must be an owner or seller.');
      }

      // Check permission
      if (!PermissionChecker.canManageSellers(req.userContext) ||
          (req.userContext.role === 'owner' && req.userContext.ownerId !== ownerId)) {
        throw new ApiError(403, 'Forbidden: Cannot delete tokens for this owner');
      }

      await registrationService.deleteToken(tokenId, ownerId);

      const response: ApiResponse<null> = {
        status: 'success',
        message: 'Token deleted successfully',
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Link a key to a user's account after registration
   * The key is linked but NOT activated (timer doesn't start yet)
   */
  async linkKey(req: Request, res: Response, next: NextFunction) {
    try {
      const { token, keyValue, userId } = req.body;

      if (!token || !keyValue || !userId) {
        throw new ApiError(400, 'Token, key value, and userId are required');
      }

      // Validate token and get key details
      const regToken = await registrationService.validateUserToken(token, keyValue);

      if (!regToken.key) {
        throw new ApiError(400, 'No key found for this token');
      }

      // Link key to user (status stays as "waiting", not activated yet)
      await userSubscriptionService.registerUserWithKey(
        userId,
        regToken.key.id,
        regToken.owner.id
      );

      // Mark token as used
      await registrationService.markTokenAsUsed(regToken.id, userId);

      const response: ApiResponse<null> = {
        status: 'success',
        message: 'Key linked to your account. Log in and click Activate to start your subscription.',
        timestamp: Date.now(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get program info by slug (for user registration without token)
   */
  async getProgramBySlug(req: Request, res: Response, next: NextFunction) {
    try {
      const { slug } = req.query;

      if (!slug || typeof slug !== 'string') {
        throw new ApiError(400, 'Slug is required');
      }

      const program = await registrationService.getProgramBySlug(slug);

      const response: ApiResponse<any> = {
        status: 'success',
        data: program,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Link a key to a user without token (direct method for user registration)
   */
  async linkKeyDirect(req: Request, res: Response, next: NextFunction) {
    try {
      const { keyValue, userId, programSlug } = req.body;

      if (!keyValue || !userId || !programSlug) {
        throw new ApiError(400, 'Key value, userId, and program slug are required');
      }

      await registrationService.linkKeyToUser(keyValue, userId, programSlug);

      const response: ApiResponse<null> = {
        status: 'success',
        message: 'Key linked to your account. Log in and click Activate to start your subscription.',
        timestamp: Date.now(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Link a seller token after registration
   */
  async linkSellerToken(req: Request, res: Response, next: NextFunction) {
    try {
      const { token, userId } = req.body;

      if (!token || !userId) {
        throw new ApiError(400, 'Token and userId are required');
      }

      // Validate token
      const regToken = await registrationService.validateSellerToken(token);

      // Mark token as used
      await registrationService.markTokenAsUsed(regToken.id, userId);

      const response: ApiResponse<null> = {
        status: 'success',
        message: 'Seller account activated successfully.',
        timestamp: Date.now(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
}

export const registrationController = new RegistrationController();
