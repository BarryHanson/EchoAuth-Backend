import { Request, Response, NextFunction } from 'express';
import { CheatFileService } from '../services/CheatFileService';
import { ApiError } from '../middleware/errorHandler';
import { ApiResponse } from '../types';
import { Role } from '../utils/permissions';

export class CheatFileController {
  private getOwnerId(req: any): number {
    if (!req.userContext) {
      throw new ApiError(401, 'Unauthorized');
    }

    let ownerId = req.userContext.ownerId;
    if (!ownerId) {
      throw new ApiError(400, 'ownerId is required');
    }

    if (req.userContext.role === Role.GOD && req.body?.ownerId) {
      ownerId = req.body.ownerId;
    }

    return ownerId;
  }

  /**
   * Upload a file for a cheat
   */
  async uploadCheatFile(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      if (req.userContext.role !== Role.OWNER && req.userContext.role !== Role.GOD) {
        throw new ApiError(403, 'Forbidden: Only owners can upload files');
      }

      // Get cheatId from URL params
      const { cheatId: cheatIdParam } = req.params;
      if (!cheatIdParam) {
        throw new ApiError(400, 'cheatId is required');
      }

      const cheatId = parseInt(cheatIdParam);
      if (isNaN(cheatId)) {
        throw new ApiError(400, 'Invalid cheatId');
      }

      if (!req.file) {
        throw new ApiError(400, 'No file provided');
      }

      // Limit file size to 50MB
      const MAX_FILE_SIZE = 50 * 1024 * 1024;
      if (req.file.size > MAX_FILE_SIZE) {
        throw new ApiError(413, 'File size exceeds maximum limit of 50MB');
      }

      const ownerId = this.getOwnerId(req);

      const fileData = await CheatFileService.uploadCheatFile(
        cheatId,
        req.file.buffer,
        req.file.originalname,
        ownerId
      );

      const response: ApiResponse<typeof fileData> = {
        status: 'success',
        message: 'File uploaded successfully',
        data: fileData,
        timestamp: Date.now(),
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Download a file (with secure access)
   */
  async downloadCheatFile(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      if (req.userContext.role !== Role.OWNER && req.userContext.role !== Role.GOD) {
        throw new ApiError(403, 'Forbidden: Only owners can download files');
      }

      const { cheatId } = req.params;
      const cheatIdNumber = parseInt(cheatId || '0');
      if (!cheatId || isNaN(cheatIdNumber)) {
        throw new ApiError(400, 'Invalid cheatId');
      }

      const ownerId = this.getOwnerId(req);
      const file = await CheatFileService.downloadCheatFile(cheatIdNumber, ownerId);

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', file.size.toString());
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      res.setHeader('X-Content-Hash', file.hash);
      res.setHeader('X-Filename', file.filename);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Access-Control-Expose-Headers', 'X-Filename, X-Content-Hash, Content-Disposition');

      res.send(file.buffer);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get file info (metadata only)
   */
  async getCheatFileInfo(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      if (req.userContext.role !== Role.OWNER && req.userContext.role !== Role.GOD) {
        throw new ApiError(403, 'Forbidden: Only owners can view file info');
      }

      const { cheatId } = req.params;
      const cheatIdNumber = parseInt(cheatId || '0');
      if (!cheatId || isNaN(cheatIdNumber)) {
        throw new ApiError(400, 'Invalid cheatId');
      }

      const ownerId = this.getOwnerId(req);
      const fileInfo = await CheatFileService.getCheatFileInfo(cheatIdNumber, ownerId);

      const response: ApiResponse<typeof fileInfo> = {
        status: 'success',
        data: fileInfo,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete a file
   */
  async deleteCheatFile(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userContext) {
        throw new ApiError(401, 'Unauthorized');
      }

      if (req.userContext.role !== Role.OWNER && req.userContext.role !== Role.GOD) {
        throw new ApiError(403, 'Forbidden: Only owners can delete files');
      }

      const { cheatId } = req.params;
      const cheatIdNumber = parseInt(cheatId || '0');
      if (!cheatId || isNaN(cheatIdNumber)) {
        throw new ApiError(400, 'Invalid cheatId');
      }

      const ownerId = this.getOwnerId(req);
      await CheatFileService.deleteCheatFile(cheatIdNumber, ownerId);

      const response: ApiResponse<null> = {
        status: 'success',
        message: 'File deleted successfully',
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }
}

export const cheatFileController = new CheatFileController();
