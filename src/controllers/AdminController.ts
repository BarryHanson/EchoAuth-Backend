import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { keyService } from '../services/KeyService';
import { cheatService } from '../services/CheatService';
import { logService } from '../services/LogService';
import { banService } from '../services/BanService';
import { userService } from '../services/UserService';
import { loaderService } from '../services/LoaderService';
import { authService } from '../services/AuthService';
import { ApiResponse } from '../types';
import { PermissionChecker, Role } from '../utils/permissions';
import { ApiError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

export class AdminController {
  async generateKey(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const { key, cheatId, days, ownerId: bodyOwnerId } = req.body;

      if (!key || !days) {
        res.status(400).json({
          status: 'error',
          message: 'Key and days are required',
          timestamp: Date.now(),
        });
        return;
      }

      // For owners: default to their own ownerId if not specified
      let targetOwnerId = bodyOwnerId;
      if (!targetOwnerId) {
        if (req.userContext.role === Role.OWNER) {
          targetOwnerId = req.userContext.ownerId;
        } else if (req.userContext.role === Role.SELLER) {
          targetOwnerId = req.userContext.ownerId;
        } else if (req.userContext.role !== Role.GOD) {
          throw new ApiError(400, 'ownerId is required');
        }
      }

      if (!targetOwnerId) {
        throw new ApiError(400, 'ownerId could not be determined');
      }

      // Check permission - for owners, verify they own this program
      if (req.userContext.role === Role.OWNER) {
        const ownerRecord = await prisma.owner.findUnique({
          where: { id: targetOwnerId },
        });
        if (!ownerRecord || ownerRecord.userId !== req.userContext.userId) {
          throw new ApiError(403, 'Forbidden: Cannot generate keys for this owner');
        }
      } else if (req.userContext.role === Role.SELLER) {
        // Check seller permissions and key limit
        const seller = await prisma.seller.findUnique({
          where: { userId: req.userContext.userId },
        });

        if (!seller || seller.ownerId !== targetOwnerId) {
          throw new ApiError(403, 'Forbidden: You can only generate keys for your assigned program');
        }

        if (!seller.canGenerateKeys) {
          throw new ApiError(403, 'Forbidden: You do not have permission to generate keys');
        }

        // Check key limit (0 = unlimited)
        if (seller.maxKeysLimit > 0 && seller.keysGenerated >= seller.maxKeysLimit) {
          throw new ApiError(403, `You have reached your key generation limit of ${seller.maxKeysLimit}`);
        }
      } else if (!PermissionChecker.canGenerateKeys(req.userContext, targetOwnerId)) {
        throw new ApiError(403, 'Forbidden: Cannot generate keys for this owner');
      }

      const newKey = await keyService.generateKey(key, req.userContext.username, cheatId, days, targetOwnerId);

      // Update seller key count if this is a seller
      if (req.userContext.role === Role.SELLER) {
        await prisma.seller.update({
          where: { userId: req.userContext.userId },
          data: { keysGenerated: { increment: 1 } },
        });
      }

      const response: ApiResponse<typeof newKey> = {
        status: 'success',
        data: newKey,
        timestamp: Date.now(),
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }

  async getAllKeys(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const creator = req.query.creator as string | undefined;
      // Query parameter takes precedence, otherwise use user's ownerId
      const queryOwnerId = req.query.ownerId ? parseInt(req.query.ownerId as string) : undefined;
      let ownerId = queryOwnerId || req.userContext.ownerId;
      let keyCreator: string | undefined = undefined;

      if (!ownerId) {
        throw new ApiError(400, 'ownerId is required');
      }

      // Check permission - for owners, verify they own this program
      if (req.userContext.role === Role.OWNER) {
        const ownerRecord = await prisma.owner.findUnique({
          where: { id: ownerId },
        });
        if (!ownerRecord || ownerRecord.userId !== req.userContext.userId) {
          throw new ApiError(403, 'Forbidden: Cannot view keys for this owner');
        }
        // Owners can see all keys for their program (keyCreator remains undefined)
      } else if (req.userContext.role === Role.SELLER) {
        // Sellers can only view their own program's keys that they created
        const seller = await prisma.seller.findUnique({
          where: { userId: req.userContext.userId },
        });

        if (!seller || seller.ownerId !== ownerId) {
          logger.warn('Seller access denied', { userId: req.userContext.userId, requestedOwnerId: ownerId, sellerOwnerId: seller?.ownerId });
          throw new ApiError(403, 'Forbidden: You can only view keys for your assigned program');
        }

        // MANDATORY filter to only seller's keys - sellers can ONLY see keys they created
        keyCreator = req.userContext.username;
        logger.info('Seller filter applied', { username: keyCreator, ownerId, userId: req.userContext.userId });
        if (!keyCreator) {
          throw new ApiError(500, 'Unable to determine seller identity for key filtering');
        }
      } else if (!PermissionChecker.canManageKeysForOwner(req.userContext, ownerId)) {
        throw new ApiError(403, 'Forbidden: Cannot view keys for this owner');
      }

      // If a creator is explicitly provided in query (for debugging/admin), use it
      // But for sellers, override with their username
      if (creator && req.userContext.role !== Role.SELLER) {
        keyCreator = creator;
      }

      const keys = await keyService.getAllKeys(keyCreator, ownerId);

      const response: ApiResponse<typeof keys> = {
        status: 'success',
        data: keys,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async banKey(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const { key, reason, ownerId: bodyOwnerId } = req.body;

      if (!key || !reason) {
        res.status(400).json({
          status: 'error',
          message: 'Key and reason are required',
          timestamp: Date.now(),
        });
        return;
      }

      // Default to user's ownerId if not specified
      const targetOwnerId = bodyOwnerId || req.userContext.ownerId;

      if (!targetOwnerId) {
        throw new ApiError(400, 'ownerId is required or must be determinable from your role');
      }

      if (!PermissionChecker.canManageKeysForOwner(req.userContext, targetOwnerId)) {
        throw new ApiError(403, 'Forbidden: Cannot manage keys for this owner');
      }

      await keyService.banKey(key, reason, targetOwnerId);

      const response: ApiResponse<null> = {
        status: 'success',
        message: 'Key banned',
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async unbanKey(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const { key, ownerId: bodyOwnerId } = req.body;

      if (!key) {
        res.status(400).json({
          status: 'error',
          message: 'Key is required',
          timestamp: Date.now(),
        });
        return;
      }

      // Default to user's ownerId if not specified
      const targetOwnerId = bodyOwnerId || req.userContext.ownerId;

      if (!targetOwnerId) {
        throw new ApiError(400, 'ownerId is required or must be determinable from your role');
      }

      if (!PermissionChecker.canManageKeysForOwner(req.userContext, targetOwnerId)) {
        throw new ApiError(403, 'Forbidden: Cannot manage keys for this owner');
      }

      await keyService.unbanKey(key, targetOwnerId);

      const response: ApiResponse<null> = {
        status: 'success',
        message: 'Key unbanned',
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async deleteKey(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const { keyId } = req.body;

      if (!keyId) {
        throw new ApiError(400, 'keyId is required');
      }

      // Get the key to check ownership
      const keyData = await prisma.key.findUnique({
        where: { id: keyId },
      });

      if (!keyData) {
        throw new ApiError(404, 'Key not found');
      }

      // Check permission - verify owner
      if (req.userContext.role === 'owner') {
        const ownerRecord = await prisma.owner.findUnique({
          where: { id: keyData.ownerId },
        });
        if (!ownerRecord || ownerRecord.userId !== req.userContext.userId) {
          throw new ApiError(403, 'Forbidden: Cannot delete keys for this owner');
        }
      } else if (!PermissionChecker.canManageKeysForOwner(req.userContext, keyData.ownerId)) {
        throw new ApiError(403, 'Forbidden: Cannot delete keys for this owner');
      }

      await keyService.deleteKey(keyId, keyData.ownerId);

      const response: ApiResponse<null> = {
        status: 'success',
        message: 'Key deleted successfully',
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async resetHwid(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const { keyId } = req.body;

      if (!keyId) {
        throw new ApiError(400, 'keyId is required');
      }

      // Get the key to check ownership
      const keyData = await prisma.key.findUnique({
        where: { id: keyId },
      });

      if (!keyData) {
        throw new ApiError(404, 'Key not found');
      }

      // Check permission - verify owner
      if (req.userContext.role === 'owner') {
        const ownerRecord = await prisma.owner.findUnique({
          where: { id: keyData.ownerId },
        });
        if (!ownerRecord || ownerRecord.userId !== req.userContext.userId) {
          throw new ApiError(403, 'Forbidden: Cannot reset HWID for this owner');
        }
      } else if (!PermissionChecker.canManageKeysForOwner(req.userContext, keyData.ownerId)) {
        throw new ApiError(403, 'Forbidden: Cannot reset HWID for this owner');
      }

      await keyService.resetHwid(keyData.key, keyData.ownerId);

      const response: ApiResponse<null> = {
        status: 'success',
        message: 'HWID reset successfully',
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async createCheat(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const { name, filename, process, injection, external } = req.body;
      let { ownerId } = req.body;

      if (!name || !filename || !process || !injection) {
        res.status(400).json({
          status: 'error',
          message: 'Name, filename, process, and injection are required',
          timestamp: Date.now(),
        });
        return;
      }

      // Default to user's ownerId if not provided
      if (!ownerId) {
        if (req.userContext.role === Role.OWNER) {
          ownerId = req.userContext.ownerId;
        } else if (req.userContext.role !== Role.GOD) {
          throw new ApiError(400, 'ownerId is required');
        }
      }

      if (!ownerId) {
        throw new ApiError(400, 'ownerId could not be determined');
      }

      if (!PermissionChecker.canManageCheatForOwner(req.userContext, ownerId)) {
        throw new ApiError(403, 'Forbidden: Cannot manage cheats for this owner');
      }

      const cheat = await cheatService.createCheat(
        name,
        filename,
        process,
        injection,
        external || false,
        req.userContext.username,
        ownerId
      );

      const response: ApiResponse<typeof cheat> = {
        status: 'success',
        data: cheat,
        timestamp: Date.now(),
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }

  async getAllCheats(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const ownerId = parseInt(req.query.ownerId as string) || req.userContext.ownerId;

      if (!ownerId) {
        throw new ApiError(400, 'ownerId is required');
      }

      if (!PermissionChecker.canManageCheatForOwner(req.userContext, ownerId)) {
        throw new ApiError(403, 'Forbidden: Cannot view cheats for this owner');
      }

      const cheats = await cheatService.getAllCheats(ownerId);

      const response: ApiResponse<typeof cheats> = {
        status: 'success',
        data: cheats,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async updateCheatStatus(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const cheatId = parseInt(req.params.id);
      const { status } = req.body;

      if (!cheatId || !status) {
        throw new ApiError(400, 'Cheat ID and status are required');
      }

      // Get ownerId from user context
      let ownerId = req.userContext.ownerId;
      if (!ownerId) {
        throw new ApiError(403, 'Owner ID not found in user context');
      }

      if (!PermissionChecker.canManageCheatForOwner(req.userContext, ownerId)) {
        throw new ApiError(403, 'Forbidden: Cannot manage cheats for this owner');
      }

      const cheat = await cheatService.updateCheatStatus(cheatId, status, ownerId);

      const response: ApiResponse<typeof cheat> = {
        status: 'success',
        data: cheat,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async updateCheat(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const cheatId = parseInt(req.params.id);
      const { name, process, injection, external, requireHwidLock, requireIpLock, status } = req.body;

      if (!cheatId || isNaN(cheatId)) {
        throw new ApiError(400, 'Invalid cheat ID');
      }

      // Get the cheat to verify ownership
      const cheat = await prisma.cheat.findUnique({
        where: { id: cheatId },
      });

      if (!cheat) {
        throw new ApiError(404, 'Cheat not found');
      }

      // Check permission
      if (req.userContext.role === Role.OWNER) {
        const owner = await prisma.owner.findFirst({
          where: { userId: req.userContext.userId, id: cheat.ownerId },
        });
        if (!owner) {
          throw new ApiError(403, 'Forbidden: Cannot edit this cheat');
        }
      } else if (!PermissionChecker.canManageCheatForOwner(req.userContext, cheat.ownerId)) {
        throw new ApiError(403, 'Forbidden: Cannot edit this cheat');
      }

      const updatedCheat = await prisma.cheat.update({
        where: { id: cheatId },
        data: {
          ...(name && { name }),
          ...(process && { process }),
          ...(injection && { injection }),
          ...(external !== undefined && { external }),
          ...(requireHwidLock !== undefined && { requireHwidLock }),
          ...(requireIpLock !== undefined && { requireIpLock }),
          ...(status && { status }),
        },
      });

      const response: ApiResponse<typeof updatedCheat> = {
        status: 'success',
        data: updatedCheat,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async deleteCheat(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const cheatId = parseInt(req.params.id);

      if (!cheatId || isNaN(cheatId)) {
        throw new ApiError(400, 'Invalid cheat ID');
      }

      // Get the cheat to verify ownership
      const cheat = await prisma.cheat.findUnique({
        where: { id: cheatId },
      });

      if (!cheat) {
        throw new ApiError(404, 'Cheat not found');
      }

      // Check permission
      if (req.userContext.role === Role.OWNER) {
        const owner = await prisma.owner.findFirst({
          where: { userId: req.userContext.userId, id: cheat.ownerId },
        });
        if (!owner) {
          throw new ApiError(403, 'Forbidden: Cannot delete this cheat');
        }
      } else if (!PermissionChecker.canManageCheatForOwner(req.userContext, cheat.ownerId)) {
        throw new ApiError(403, 'Forbidden: Cannot delete this cheat');
      }

      // Delete the cheat (cascade will handle related records)
      await prisma.cheat.delete({
        where: { id: cheatId },
      });

      const response: ApiResponse<null> = {
        status: 'success',
        message: 'Cheat deleted successfully',
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async getAllLogs(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      const ownerId = parseInt(req.query.ownerId as string) || req.userContext.ownerId;

      if (!ownerId) {
        throw new ApiError(400, 'ownerId is required');
      }

      if (!PermissionChecker.canViewLogsForOwner(req.userContext, ownerId)) {
        throw new ApiError(403, 'Forbidden: Cannot view logs for this owner');
      }

      const { logs, total } = await logService.getAllLogs(limit, offset, ownerId);

      const response: ApiResponse<any> = {
        status: 'success',
        data: { logs, total },
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async getAllBans(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const ownerId = parseInt(req.query.ownerId as string) || req.userContext.ownerId;

      if (!ownerId) {
        throw new ApiError(400, 'ownerId is required');
      }

      if (!PermissionChecker.canManageBansForOwner(req.userContext, ownerId)) {
        throw new ApiError(403, 'Forbidden: Cannot view bans for this owner');
      }

      const bans = await banService.getAllBans(ownerId);

      const response: ApiResponse<any> = {
        status: 'success',
        data: bans,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async banHwid(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const { hwid, reason, ownerId } = req.body;

      if (!hwid || !reason || !ownerId) {
        res.status(400).json({
          status: 'error',
          message: 'HWID, reason, and ownerId are required',
          timestamp: Date.now(),
        });
        return;
      }

      if (!PermissionChecker.canManageBansForOwner(req.userContext, ownerId)) {
        throw new ApiError(403, 'Forbidden: Cannot manage bans for this owner');
      }

      const ban = await banService.banHwid(hwid, reason, ownerId);

      const response: ApiResponse<any> = {
        status: 'success',
        data: ban,
        timestamp: Date.now(),
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }

  async unbanHwid(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const { hwid, ownerId } = req.body;

      if (!hwid || !ownerId) {
        res.status(400).json({
          status: 'error',
          message: 'HWID and ownerId are required',
          timestamp: Date.now(),
        });
        return;
      }

      if (!PermissionChecker.canManageBansForOwner(req.userContext, ownerId)) {
        throw new ApiError(403, 'Forbidden: Cannot manage bans for this owner');
      }

      await banService.unbanHwid(hwid, ownerId);

      const response: ApiResponse<null> = {
        status: 'success',
        message: 'HWID unbanned',
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async getKeyStats(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      // Query parameter takes precedence, otherwise use user's ownerId
      const queryOwnerId = req.query.ownerId ? parseInt(req.query.ownerId as string) : undefined;
      const ownerId = queryOwnerId || req.userContext.ownerId;

      if (!ownerId) {
        throw new ApiError(400, 'ownerId is required or must be determinable from your role');
      }

      if (!PermissionChecker.canViewStatsForOwner(req.userContext, ownerId)) {
        throw new ApiError(403, 'Forbidden: Cannot view stats for this owner');
      }

      const stats = await keyService.getKeyStats(ownerId);

      const response: ApiResponse<any> = {
        status: 'success',
        data: stats,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async getAllUsers(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      if (!PermissionChecker.canViewAllUsers(req.userContext)) {
        throw new ApiError(403, 'Forbidden: Only God can view all users');
      }

      const users = await userService.getAllUsers();

      const response: ApiResponse<typeof users> = {
        status: 'success',
        data: users,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async deleteUser(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const { username } = req.body;

      if (!username) {
        res.status(400).json({
          status: 'error',
          message: 'Username is required',
          timestamp: Date.now(),
        });
        return;
      }

      // Only God can delete users
      if (!PermissionChecker.canManageOwners(req.userContext)) {
        throw new ApiError(403, 'Forbidden: Only God can delete users');
      }

      await userService.deleteUserByUsername(username);

      const response: ApiResponse<null> = {
        status: 'success',
        message: 'User deleted',
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async getAllLoaders(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      if (!PermissionChecker.canAccessAdmin(req.userContext)) {
        throw new ApiError(403, 'Forbidden: Admin access required');
      }

      const loaders = await loaderService.getAllLoaders();

      const response: ApiResponse<typeof loaders> = {
        status: 'success',
        data: loaders,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async createLoader(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const { name, version, file, requireFilenameMatch } = req.body;

      if (!name || !version || !file) {
        res.status(400).json({
          status: 'error',
          message: 'Name, version, and file are required',
          timestamp: Date.now(),
        });
        return;
      }

      if (!PermissionChecker.canAccessAdmin(req.userContext)) {
        throw new ApiError(403, 'Forbidden: Admin access required');
      }

      const loader = await loaderService.createLoader(name, version, file, requireFilenameMatch ?? false);

      const response: ApiResponse<typeof loader> = {
        status: 'success',
        data: loader,
        timestamp: Date.now(),
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }

  async updateLoader(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const { loaderId } = req.params;
      const { name, version, file, requireFilenameMatch } = req.body;

      if (!PermissionChecker.canAccessAdmin(req.userContext)) {
        throw new ApiError(403, 'Forbidden: Admin access required');
      }

      const loader = await loaderService.updateLoader(parseInt(loaderId), {
        name,
        version,
        file,
        requireFilenameMatch,
      });

      const response: ApiResponse<typeof loader> = {
        status: 'success',
        data: loader,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async updateLoaderVersion(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const { loaderId, version } = req.body;

      if (!loaderId || !version) {
        res.status(400).json({
          status: 'error',
          message: 'Loader ID and version are required',
          timestamp: Date.now(),
        });
        return;
      }

      if (!PermissionChecker.canAccessAdmin(req.userContext)) {
        throw new ApiError(403, 'Forbidden: Admin access required');
      }

      const loader = await loaderService.updateLoaderVersion(loaderId, version);

      const response: ApiResponse<typeof loader> = {
        status: 'success',
        data: loader,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async getSellerInfo(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      if (req.userContext.role !== Role.SELLER) {
        throw new ApiError(403, 'Forbidden: This endpoint is for sellers only');
      }

      const seller = await prisma.seller.findUnique({
        where: { userId: req.userContext.userId },
      });

      if (!seller) {
        throw new ApiError(404, 'Seller profile not found');
      }

      const response: ApiResponse<typeof seller> = {
        status: 'success',
        data: seller,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async updateSellerQuota(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const { sellerId, maxKeysLimit } = req.body;

      if (!sellerId || maxKeysLimit === undefined) {
        throw new ApiError(400, 'sellerId and maxKeysLimit are required');
      }

      // Verify ownership - get the seller and check the program owner
      const seller = await prisma.seller.findUnique({
        where: { id: sellerId },
        include: { owner: true },
      });

      if (!seller) {
        throw new ApiError(404, 'Seller not found');
      }

      if (seller.owner.userId !== req.userContext.userId && req.userContext.role !== Role.GOD) {
        throw new ApiError(403, 'Forbidden: You do not own this seller');
      }

      const updated = await prisma.seller.update({
        where: { id: sellerId },
        data: { maxKeysLimit },
      });

      logger.info('Seller quota updated', { sellerId, maxKeysLimit, ownerId: seller.ownerId });

      const response: ApiResponse<typeof updated> = {
        status: 'success',
        data: updated,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async toggleSellerActive(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const { sellerId, isActive } = req.body;

      if (!sellerId || isActive === undefined) {
        throw new ApiError(400, 'sellerId and isActive are required');
      }

      const seller = await prisma.seller.findUnique({
        where: { id: sellerId },
        include: { owner: true },
      });

      if (!seller) {
        throw new ApiError(404, 'Seller not found');
      }

      if (seller.owner.userId !== req.userContext.userId && req.userContext.role !== Role.GOD) {
        throw new ApiError(403, 'Forbidden: You do not own this seller');
      }

      const updated = await prisma.seller.update({
        where: { id: sellerId },
        data: { isActive },
      });

      logger.info('Seller status toggled', { sellerId, isActive, ownerId: seller.ownerId });

      const response: ApiResponse<typeof updated> = {
        status: 'success',
        data: updated,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async resetSellerKeyCount(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const { sellerId } = req.body;

      if (!sellerId) {
        throw new ApiError(400, 'sellerId is required');
      }

      const seller = await prisma.seller.findUnique({
        where: { id: sellerId },
        include: { owner: true },
      });

      if (!seller) {
        throw new ApiError(404, 'Seller not found');
      }

      if (seller.owner.userId !== req.userContext.userId && req.userContext.role !== Role.GOD) {
        throw new ApiError(403, 'Forbidden: You do not own this seller');
      }

      const updated = await prisma.seller.update({
        where: { id: sellerId },
        data: { keysGenerated: 0 },
      });

      logger.info('Seller key count reset', { sellerId, ownerId: seller.ownerId });

      const response: ApiResponse<typeof updated> = {
        status: 'success',
        data: updated,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async deleteSeller(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const { sellerId } = req.body;

      if (!sellerId) {
        throw new ApiError(400, 'sellerId is required');
      }

      const seller = await prisma.seller.findUnique({
        where: { id: sellerId },
        include: { owner: true },
      });

      if (!seller) {
        throw new ApiError(404, 'Seller not found');
      }

      if (seller.owner.userId !== req.userContext.userId && req.userContext.role !== Role.GOD) {
        throw new ApiError(403, 'Forbidden: You do not own this seller');
      }

      await prisma.seller.delete({
        where: { id: sellerId },
      });

      logger.info('Seller deleted', { sellerId, sellerUserId: seller.userId, ownerId: seller.ownerId });

      const response: ApiResponse<{ success: true }> = {
        status: 'success',
        data: { success: true },
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async getProgramSellers(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const { ownerId } = req.params;
      const ownIdNum = parseInt(ownerId);

      if (!ownIdNum) {
        throw new ApiError(400, 'ownerId is required');
      }

      // Verify ownership
      const owner = await prisma.owner.findUnique({
        where: { id: ownIdNum },
      });

      if (!owner || (owner.userId !== req.userContext.userId && req.userContext.role !== Role.GOD)) {
        throw new ApiError(403, 'Forbidden: You do not own this program');
      }

      const sellers = await prisma.seller.findMany({
        where: { ownerId: ownIdNum },
        include: {
          user: {
            select: { username: true, id: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const response: ApiResponse<typeof sellers> = {
        status: 'success',
        data: sellers,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async deleteProgram(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      const { ownerId } = req.body;

      if (!ownerId) {
        throw new ApiError(400, 'ownerId is required');
      }

      // Verify ownership
      const ownerRecord = await prisma.owner.findUnique({
        where: { id: ownerId },
      });

      if (!ownerRecord || ownerRecord.userId !== req.userContext.userId) {
        throw new ApiError(403, 'Forbidden: You do not own this program');
      }

      // Delete in cascade order to avoid foreign key constraints
      // 1. Delete UserKey entries (user subscriptions)
      await prisma.userKey.deleteMany({
        where: {
          key: {
            ownerId,
          },
        },
      });

      // 2. Delete Keys
      await prisma.key.deleteMany({
        where: { ownerId },
      });

      // 3. Delete Sellers assigned to this program
      await prisma.seller.deleteMany({
        where: { ownerId },
      });

      // 4. Delete the program/owner itself
      await prisma.owner.delete({
        where: { id: ownerId },
      });

      logger.info('Program deleted', { ownerId, userId: req.userContext.userId, programName: ownerRecord.programName });

      const response: ApiResponse<{ success: true }> = {
        status: 'success',
        data: { success: true },
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }
}

export const adminController = new AdminController();
