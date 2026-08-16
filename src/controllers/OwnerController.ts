import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { ApiResponse } from '../types';
import { PermissionChecker, Role } from '../utils/permissions';
import { ApiError } from '../middleware/errorHandler';
import { authService } from '../services/AuthService';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

export class OwnerController {
  /**
   * Create a new owner/program
   * God can create new owner accounts with programs
   * Owner can create additional programs under their account
   */
  async createOwner(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const { username, password, programName, programSlug, description } = req.body;

      if (!programName || !programSlug) {
        res.status(400).json({
          status: 'error',
          message: 'Program name and program slug are required',
          timestamp: Date.now(),
        });
        return;
      }

      let userId: number;

      // If God: create new owner account
      if (req.userContext.role === Role.GOD) {
        if (!username || !password) {
          res.status(400).json({
            status: 'error',
            message: 'Username and password are required for creating new owner accounts',
            timestamp: Date.now(),
          });
          return;
        }

        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
          where: { username },
        });

        if (existingUser) {
          throw new ApiError(400, 'Username already exists');
        }

        // Create user with owner role
        const user = await authService.registerUser(username, password, Role.OWNER);
        userId = user.id;
      }
      // If Owner: use their own account
      else if (req.userContext.role === Role.OWNER) {
        userId = req.userContext.userId;
      }
      // Any other role is forbidden
      else {
        throw new ApiError(403, 'Forbidden: Only God and Owners can create programs');
      }

      // Create owner record with generated API secret
      const { randomBytes } = require('crypto');
      const apiSecret = `secret_${randomBytes(32).toString('hex')}`;

      const owner = await prisma.owner.create({
        data: {
          userId,
          programName,
          programSlug,
          description: description || '',
          apiSecret,
        },
      });

      logger.info('Owner created', { ownerId: owner.id, programName, userId });

      const response: ApiResponse<any> = {
        status: 'success',
        data: {
          id: owner.id,
          userId: owner.userId,
          programName: owner.programName,
          programSlug: owner.programSlug,
          description: owner.description,
          createdAt: owner.createdAt,
        },
        timestamp: Date.now(),
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all owners
   * God gets all owners, Owner gets only their own programs
   */
  async getAllOwners(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      let where: any = {};

      // If owner, only get their programs
      if (req.userContext.role === Role.OWNER) {
        where = { userId: req.userContext.userId };
      }
      // God gets all

      const owners = await prisma.owner.findMany({
        where,
        include: {
          user: {
            select: { username: true },
          },
          _count: {
            select: { sellers: true, keys: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const response: ApiResponse<any> = {
        status: 'success',
        data: owners.map((owner) => ({
          id: owner.id,
          username: owner.user?.username || 'Unknown',
          programName: owner.programName,
          programSlug: owner.programSlug,
          description: owner.description,
          sellerCount: owner._count.sellers,
          keyCount: owner._count.keys,
          createdAt: owner.createdAt,
        })),
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get owner details
   * God or Owner role
   */
  async getOwner(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const ownerId = parseInt(req.params.ownerId);

      if (!ownerId) {
        res.status(400).json({
          status: 'error',
          message: 'Owner ID is required',
          timestamp: Date.now(),
        });
        return;
      }

      // Only God can view any owner, Owners can only view themselves
      if (req.userContext.role === Role.OWNER && req.userContext.ownerId !== ownerId) {
        throw new ApiError(403, 'Forbidden: Owners can only view their own details');
      } else if (req.userContext.role !== Role.GOD && req.userContext.role !== Role.OWNER) {
        throw new ApiError(403, 'Forbidden: Only God and Owners can view owner details');
      }

      const owner = await prisma.owner.findUnique({
        where: { id: ownerId },
        include: {
          user: {
            select: { username: true },
          },
          _count: {
            select: { sellers: true, keys: true },
          },
        },
      });

      if (!owner) {
        throw new ApiError(404, 'Owner not found');
      }

      const response: ApiResponse<any> = {
        status: 'success',
        data: {
          id: owner.id,
          username: owner.user?.username || 'Unknown',
          programName: owner.programName,
          programSlug: owner.programSlug,
          description: owner.description,
          sellerCount: owner._count.sellers,
          keyCount: owner._count.keys,
          createdAt: owner.createdAt,
        },
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update owner information
   * God or Owner role
   */
  async updateOwner(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const ownerId = parseInt(req.params.ownerId);
      const { programName, programSlug, description } = req.body;

      if (!ownerId) {
        res.status(400).json({
          status: 'error',
          message: 'Owner ID is required',
          timestamp: Date.now(),
        });
        return;
      }

      // Check permission
      if (!PermissionChecker.canAccessAdmin(req.userContext) ||
          (req.userContext.role === Role.OWNER && req.userContext.ownerId !== ownerId)) {
        throw new ApiError(403, 'Forbidden: Cannot update this owner');
      }

      const owner = await prisma.owner.update({
        where: { id: ownerId },
        data: {
          ...(programName && { programName }),
          ...(programSlug && { programSlug }),
          ...(description !== undefined && { description }),
        },
      });

      logger.info('Owner updated', { ownerId, programName });

      const response: ApiResponse<any> = {
        status: 'success',
        data: {
          id: owner.id,
          programName: owner.programName,
          programSlug: owner.programSlug,
          description: owner.description,
        },
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete an owner
   * God role only
   */
  async deleteOwner(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const ownerId = parseInt(req.params.ownerId);

      if (!ownerId) {
        res.status(400).json({
          status: 'error',
          message: 'Owner ID is required',
          timestamp: Date.now(),
        });
        return;
      }

      if (!PermissionChecker.canManageOwners(req.userContext)) {
        throw new ApiError(403, 'Forbidden: Only God can delete owners');
      }

      const owner = await prisma.owner.findUnique({
        where: { id: ownerId },
      });

      if (!owner) {
        throw new ApiError(404, 'Owner not found');
      }

      await prisma.owner.delete({
        where: { id: ownerId },
      });

      logger.info('Owner deleted', { ownerId });

      const response: ApiResponse<null> = {
        status: 'success',
        message: 'Owner deleted successfully',
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create a seller for an owner
   * Owner or God role
   */
  async createSeller(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const ownerId = parseInt(req.params.ownerId);
      const { username, password, maxKeysLimit, canResetHWID, canGenerateKeys } = req.body;

      if (!ownerId) {
        res.status(400).json({
          status: 'error',
          message: 'Owner ID is required',
          timestamp: Date.now(),
        });
        return;
      }

      if (!username || !password || maxKeysLimit === undefined) {
        res.status(400).json({
          status: 'error',
          message: 'Username, password, and max keys limit are required',
          timestamp: Date.now(),
        });
        return;
      }

      // Check permission
      if (!PermissionChecker.canManageSellers(req.userContext) ||
          (req.userContext.role === Role.OWNER && req.userContext.ownerId !== ownerId)) {
        throw new ApiError(403, 'Forbidden: Cannot create seller for this owner');
      }

      // Check if owner exists
      const owner = await prisma.owner.findUnique({
        where: { id: ownerId },
      });

      if (!owner) {
        throw new ApiError(404, 'Owner not found');
      }

      // Check if username already exists
      const existingUser = await prisma.user.findUnique({
        where: { username },
      });

      if (existingUser) {
        throw new ApiError(400, 'Username already exists');
      }

      // Create seller user
      const user = await authService.registerUser(username, password, Role.SELLER);

      // Create seller record
      const seller = await prisma.seller.create({
        data: {
          userId: user.id,
          ownerId,
          maxKeysLimit,
          keysGenerated: 0,
          canResetHWID: canResetHWID !== false,
          canGenerateKeys: canGenerateKeys !== false,
          isActive: true,
        },
      });

      logger.info('Seller created', { sellerId: seller.id, ownerId, username });

      const response: ApiResponse<any> = {
        status: 'success',
        data: {
          id: seller.id,
          userId: user.id,
          username: user.username,
          ownerId: seller.ownerId,
          maxKeysLimit: seller.maxKeysLimit,
          keysGenerated: seller.keysGenerated,
          canResetHWID: seller.canResetHWID,
          canGenerateKeys: seller.canGenerateKeys,
          isActive: seller.isActive,
          createdAt: seller.createdAt,
        },
        timestamp: Date.now(),
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all sellers for an owner
   * Owner or God role
   */
  async getSellers(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const ownerId = parseInt(req.params.ownerId);

      if (!ownerId) {
        res.status(400).json({
          status: 'error',
          message: 'Owner ID is required',
          timestamp: Date.now(),
        });
        return;
      }

      // Check permission
      if (!PermissionChecker.canManageSellers(req.userContext) ||
          (req.userContext.role === Role.OWNER && req.userContext.ownerId !== ownerId)) {
        throw new ApiError(403, 'Forbidden: Cannot view sellers for this owner');
      }

      const sellers = await prisma.seller.findMany({
        where: { ownerId },
        include: {
          user: {
            select: { username: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const response: ApiResponse<any> = {
        status: 'success',
        data: sellers.map((seller) => ({
          id: seller.id,
          username: seller.user?.username || 'Unknown',
          maxKeysLimit: seller.maxKeysLimit,
          keysGenerated: seller.keysGenerated,
          canResetHWID: seller.canResetHWID,
          canGenerateKeys: seller.canGenerateKeys,
          isActive: seller.isActive,
          createdAt: seller.createdAt,
        })),
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update seller information
   * Owner or God role
   */
  async updateSeller(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const ownerId = parseInt(req.params.ownerId);
      const sellerId = parseInt(req.params.sellerId);
      const { maxKeysLimit, canResetHWID, canGenerateKeys, isActive } = req.body;

      if (!ownerId || !sellerId) {
        res.status(400).json({
          status: 'error',
          message: 'Owner ID and Seller ID are required',
          timestamp: Date.now(),
        });
        return;
      }

      // Check permission
      if (!PermissionChecker.canManageSellers(req.userContext) ||
          (req.userContext.role === Role.OWNER && req.userContext.ownerId !== ownerId)) {
        throw new ApiError(403, 'Forbidden: Cannot update seller for this owner');
      }

      const seller = await prisma.seller.findUnique({
        where: { id: sellerId },
      });

      if (!seller || seller.ownerId !== ownerId) {
        throw new ApiError(404, 'Seller not found');
      }

      const updated = await prisma.seller.update({
        where: { id: sellerId },
        data: {
          ...(maxKeysLimit !== undefined && { maxKeysLimit }),
          ...(canResetHWID !== undefined && { canResetHWID }),
          ...(canGenerateKeys !== undefined && { canGenerateKeys }),
          ...(isActive !== undefined && { isActive }),
        },
      });

      logger.info('Seller updated', { sellerId, ownerId });

      const response: ApiResponse<any> = {
        status: 'success',
        data: {
          id: updated.id,
          maxKeysLimit: updated.maxKeysLimit,
          canResetHWID: updated.canResetHWID,
          canGenerateKeys: updated.canGenerateKeys,
          isActive: updated.isActive,
        },
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete a seller
   * Owner or God role
   */
  async deleteSeller(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const ownerId = parseInt(req.params.ownerId);
      const sellerId = parseInt(req.params.sellerId);

      if (!ownerId || !sellerId) {
        res.status(400).json({
          status: 'error',
          message: 'Owner ID and Seller ID are required',
          timestamp: Date.now(),
        });
        return;
      }

      // Check permission
      if (!PermissionChecker.canManageSellers(req.userContext) ||
          (req.userContext.role === Role.OWNER && req.userContext.ownerId !== ownerId)) {
        throw new ApiError(403, 'Forbidden: Cannot delete seller for this owner');
      }

      const seller = await prisma.seller.findUnique({
        where: { id: sellerId },
      });

      if (!seller || seller.ownerId !== ownerId) {
        throw new ApiError(404, 'Seller not found');
      }

      await prisma.seller.delete({
        where: { id: sellerId },
      });

      logger.info('Seller deleted', { sellerId, ownerId });

      const response: ApiResponse<null> = {
        status: 'success',
        message: 'Seller deleted successfully',
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get current owner's program info
   * Owner role only
   */
  async getMyOwner(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      if (req.userContext.role !== Role.OWNER) {
        throw new ApiError(403, 'Forbidden: Only owners can access this endpoint');
      }

      if (!req.userContext.ownerId) {
        throw new ApiError(400, 'Owner context not found');
      }

      const owner = await prisma.owner.findUnique({
        where: { id: req.userContext.ownerId },
        include: {
          user: {
            select: { username: true },
          },
          _count: {
            select: { sellers: true, keys: true },
          },
        },
      });

      if (!owner) {
        throw new ApiError(404, 'Your program not found');
      }

      const response: ApiResponse<any> = {
        status: 'success',
        data: {
          id: owner.id,
          username: owner.user?.username || 'Unknown',
          programName: owner.programName,
          programSlug: owner.programSlug,
          description: owner.description,
          sellerCount: owner._count.sellers,
          keyCount: owner._count.keys,
          createdAt: owner.createdAt,
        },
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }
}

export const ownerController = new OwnerController();
