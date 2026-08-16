import { Request, Response, NextFunction } from 'express';
import { keyService } from '../services/KeyService';
import { cheatService } from '../services/CheatService';
import { CheatFileService } from '../services/CheatFileService';
import { logService } from '../services/LogService';
import { banService } from '../services/BanService';
import { AntiTamperingService } from '../services/AntiTamperingService';
import { encryptRequest, decryptRequest } from '../utils/encryption';
import { ApiResponse } from '../types';
import { logger } from '../utils/logger';

export class ClientController {
  private normalizeIp(ip: string | undefined): string {
    ip = ip || '0.0.0.0';
    if (ip === '::1' || ip === '::ffff:127.0.0.1') {
      return '127.0.0.1';
    } else if (ip.startsWith('::ffff:')) {
      return ip.substring(7); // Remove IPv6 prefix
    }
    return ip;
  }

  private async validateClientTimestamp(userId: number) {
    const isValid = await AntiTamperingService.validateSessionTimestamp(userId);
    if (!isValid) {
      throw new Error('Clock tampering detected: Session invalidated');
    }
  }

  async authenticate(req: Request, res: Response, next: NextFunction) {
    try {
      const { key, hwid } = req.body;

      if (!key || !hwid) {
        const response: ApiResponse<null> = {
          status: 'error',
          message: 'Key and HWID are required',
          timestamp: Date.now(),
        };
        res.status(400).json(response);
        return;
      }

      const ip = this.normalizeIp(req.ip);
      const result = await keyService.authenticateKey(key, hwid, ip);

      const response: ApiResponse<typeof result> = {
        status: 'success',
        data: result,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async getCheatInfo(req: Request, res: Response, next: NextFunction) {
    try {
      const { key, hwid, cheatId } = req.body;

      if (!key || !hwid || !cheatId) {
        res.status(400).json({
          status: 'error',
          message: 'Key, HWID, and Cheat ID are required',
          timestamp: Date.now(),
        });
        return;
      }

      const keyData = await keyService.getKeyInfo(key);
      const cheat = await cheatService.getCheatInfo(cheatId, keyData.ownerId);

      if (keyData.hwid !== hwid) {
        res.status(403).json({
          status: 'error',
          message: 'HWID mismatch',
          timestamp: Date.now(),
        });
        return;
      }

      const response: ApiResponse<any> = {
        status: 'success',
        data: {
          id: cheat.id,
          name: cheat.name,
          status: cheat.status,
          filename: cheat.filename,
          process: cheat.process,
          external: cheat.external,
          injection: cheat.injection,
          creator: cheat.creator,
        },
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async downloadCheat(req: Request, res: Response, next: NextFunction) {
    try {
      const { key, hwid, cheatId } = req.body;
      let ownerId: number | null = null;

      // Support both key-based auth and JWT auth
      if (key && hwid) {
        // Key-based auth (original flow)
        const keyData = await keyService.getKeyInfo(key);
        if (keyData.hwid !== hwid) {
          res.status(403).json({
            status: 'error',
            message: 'HWID mismatch',
            timestamp: Date.now(),
          });
          return;
        }
        ownerId = keyData.ownerId;
      } else if (req.user) {
        // JWT auth (loader flow) - validate timestamp to detect clock tampering
        await this.validateClientTimestamp(req.user.userId);

        // use owner if authenticated as owner, otherwise use a default test owner
        if (req.user.ownerId) {
          ownerId = req.user.ownerId;
        } else {
          // For testing: allow users to download from the first owner (test owner)
          // In production, this should check if the user has actual access to the cheat
          const { PrismaClient } = require('@prisma/client');
          const prisma = new PrismaClient();
          const firstOwner = await prisma.owner.findFirst();
          if (firstOwner) {
            ownerId = firstOwner.id;
          }
        }
      }

      if (!ownerId) {
        res.status(401).json({
          status: 'error',
          message: 'Authentication required (key/hwid or JWT token)',
          timestamp: Date.now(),
        });
        return;
      }

      if (!cheatId) {
        res.status(400).json({
          status: 'error',
          message: 'Cheat ID is required',
          timestamp: Date.now(),
        });
        return;
      }

      const fileData = await CheatFileService.downloadCheatFile(cheatId, ownerId);

      // Return as base64-encoded JSON for safe binary transmission
      const response: ApiResponse<{ data: string; filename: string; cheat_status: string }> = {
        status: 'success',
        data: {
          data: fileData.buffer.toString('base64'),
          filename: fileData.filename,
          cheat_status: fileData.cheat_status,
        },
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async submitLog(req: Request, res: Response, next: NextFunction) {
    try {
      const { key, hwid, message } = req.body;

      if (!key || !hwid || !message) {
        res.status(400).json({
          status: 'error',
          message: 'Key, HWID, and message are required',
          timestamp: Date.now(),
        });
        return;
      }

      const ip = this.normalizeIp(req.ip);
      await logService.createLog(hwid, key, message, ip);

      const response: ApiResponse<null> = {
        status: 'success',
        message: 'Log submitted',
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async reportCrack(req: Request, res: Response, next: NextFunction) {
    try {
      const { hwid } = req.body;

      if (!hwid) {
        res.status(400).json({
          status: 'error',
          message: 'HWID is required',
          timestamp: Date.now(),
        });
        return;
      }

      await banService.banHwid(hwid, 'Reported crack attempt');

      const response: ApiResponse<null> = {
        status: 'success',
        message: 'Report submitted',
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async getApiSecret(req: Request, res: Response, next: NextFunction) {
    try {
      // This endpoint requires authentication
      if (!req.user || !req.user.ownerId) {
        const response: ApiResponse<null> = {
          status: 'error',
          message: 'Unauthorized - owner context required',
          timestamp: Date.now(),
        };
        res.status(401).json(response);
        return;
      }

      const { PrismaClient } = require('@prisma/client');
      const prisma = new PrismaClient();

      const owner = await prisma.owner.findUnique({
        where: { id: req.user.ownerId },
        select: { apiSecret: true }
      });

      if (!owner) {
        const response: ApiResponse<null> = {
          status: 'error',
          message: 'Owner not found',
          timestamp: Date.now(),
        };
        res.status(404).json(response);
        return;
      }

      const response: ApiResponse<{ apiSecret: string }> = {
        status: 'success',
        data: { apiSecret: owner.apiSecret },
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async checkLoaderVersion(req: Request, res: Response, next: NextFunction) {
    try {
      const { loaderId, currentVersion, filename } = req.body;

      if (!loaderId || !currentVersion) {
        res.status(400).json({
          status: 'error',
          message: 'Loader ID and current version are required',
          timestamp: Date.now(),
        });
        return;
      }

      const { PrismaClient } = require('@prisma/client');
      const prisma = new PrismaClient();

      const loader = await prisma.loader.findUnique({
        where: { id: loaderId },
      });

      if (!loader) {
        res.status(404).json({
          status: 'error',
          message: 'Loader not found',
          timestamp: Date.now(),
        });
        return;
      }

      // Check version match
      const versionMatch = loader.version === currentVersion;

      // Check filename match if required
      let filenameMatch = true;
      if (loader.requireFilenameMatch && filename) {
        filenameMatch = loader.file === filename;
      }

      const response: ApiResponse<{
        isUpToDate: boolean;
        latestVersion: string;
        expectedFilename: string;
        requireFilenameMatch: boolean;
        filenameMatch: boolean;
        message?: string;
      }> = {
        status: 'success',
        data: {
          isUpToDate: versionMatch,
          latestVersion: loader.version,
          expectedFilename: loader.file,
          requireFilenameMatch: loader.requireFilenameMatch,
          filenameMatch: filenameMatch,
        },
        timestamp: Date.now(),
      };

      // Add warning messages if needed
      if (!versionMatch && response.data) {
        response.data.message = `Loader is out of date. Current: ${currentVersion}, Latest: ${loader.version}`;
      }
      if (!filenameMatch && loader.requireFilenameMatch && response.data) {
        response.data.message = `Invalid loader filename. Expected: ${loader.file}`;
      }

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async regenerateApiSecret(req: Request, res: Response, next: NextFunction) {
    try {
      // This endpoint requires authentication and owner role
      if (!req.user || !req.user.ownerId) {
        const response: ApiResponse<null> = {
          status: 'error',
          message: 'Unauthorized - owner context required',
          timestamp: Date.now(),
        };
        res.status(401).json(response);
        return;
      }

      if (req.user.role !== 'owner') {
        const response: ApiResponse<null> = {
          status: 'error',
          message: 'Forbidden - only owners can regenerate API secrets',
          timestamp: Date.now(),
        };
        res.status(403).json(response);
        return;
      }

      const { randomBytes } = require('crypto');
      const { PrismaClient } = require('@prisma/client');
      const prisma = new PrismaClient();

      const newApiSecret = `secret_${randomBytes(32).toString('hex')}`;

      const owner = await prisma.owner.update({
        where: { id: req.user.ownerId },
        data: { apiSecret: newApiSecret },
        select: { apiSecret: true, programName: true }
      });

      const response: ApiResponse<{ apiSecret: string; message: string }> = {
        status: 'success',
        data: {
          apiSecret: owner.apiSecret,
          message: `API secret regenerated for ${owner.programName}`
        },
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async submitAuthLog(req: Request, res: Response, next: NextFunction) {
    try {
      const { message, level, hwid } = req.body;

      if (!message) {
        res.status(400).json({
          status: 'error',
          message: 'Message is required',
          timestamp: Date.now(),
        });
        return;
      }

      if (!req.user) {
        res.status(401).json({
          status: 'error',
          message: 'Authentication required',
          timestamp: Date.now(),
        });
        return;
      }

      // Use provided hwid or fall back to userId
      const logHwid = hwid || req.user.userId.toString();

      // Get ownerId from user's own context if owner/seller, or from their subscription if regular user
      let ownerId = req.user?.ownerId;

      if (!ownerId) {
        // For regular users, get owner from their key subscription
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        const userKey = await prisma.userKey.findUnique({
          where: { userId: req.user.userId },
        });
        ownerId = userKey?.ownerId;
        await prisma.$disconnect();
      }

      const ip = this.normalizeIp(req.ip);

      const logMessage = level ? `[${level.toUpperCase()}] ${message}` : message;
      await logService.createLog(logHwid, 'jwt-auth', logMessage, ip, ownerId);

      const response: ApiResponse<null> = {
        status: 'success',
        message: 'Log submitted',
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async banUserAndHwid(req: Request, res: Response, next: NextFunction) {
    try {
      const { username, hwid, reason } = req.body;

      if (!username || !hwid) {
        res.status(400).json({
          status: 'error',
          message: 'Username and HWID are required',
          timestamp: Date.now(),
        });
        return;
      }

      if (!req.user) {
        res.status(401).json({
          status: 'error',
          message: 'Authentication required',
          timestamp: Date.now(),
        });
        return;
      }

      // Ban the HWID
      await banService.banHwid(hwid, reason || 'Banned by security system');

      // Log the ban action
      const ip = this.normalizeIp(req.ip);
      await logService.createLog(hwid, username, `User ${username} banned - ${reason || 'Security violation'}`, ip, req.user?.ownerId);

      const response: ApiResponse<null> = {
        status: 'success',
        message: `User ${username} and HWID ${hwid} have been banned`,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }
}

export const clientController = new ClientController();
