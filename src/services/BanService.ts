import { PrismaClient } from '@prisma/client';
import { ApiError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

const DEFAULT_OWNER_ID = 1;

export class BanService {
  async banHwid(hwid: string, reason: string, ownerId: number = DEFAULT_OWNER_ID) {
    const existing = await prisma.hWID.findUnique({
      where: { hwid_ownerId: { hwid, ownerId } },
    });

    if (existing) {
      throw new ApiError(400, 'HWID already banned');
    }

    const ban = await prisma.hWID.create({
      data: {
        hwid,
        reason,
        ownerId,
      },
    });

    logger.info('HWID banned', { hwid, reason, ownerId });

    return ban;
  }

  async unbanHwid(hwid: string, ownerId: number = DEFAULT_OWNER_ID) {
    const ban = await prisma.hWID.findUnique({
      where: { hwid_ownerId: { hwid, ownerId } },
    });

    if (!ban) {
      throw new ApiError(404, 'HWID ban not found');
    }

    await prisma.hWID.delete({
      where: { hwid_ownerId: { hwid, ownerId } },
    });

    logger.info('HWID unbanned', { hwid, ownerId });
  }

  async checkIfBanned(hwid: string, ownerId: number = DEFAULT_OWNER_ID): Promise<boolean> {
    const ban = await prisma.hWID.findUnique({
      where: { hwid_ownerId: { hwid, ownerId } },
    });

    return !!ban;
  }

  async getAllBans(ownerId: number = DEFAULT_OWNER_ID) {
    return await prisma.hWID.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getBanInfo(hwid: string, ownerId: number = DEFAULT_OWNER_ID) {
    const ban = await prisma.hWID.findUnique({
      where: { hwid_ownerId: { hwid, ownerId } },
    });

    if (!ban) {
      throw new ApiError(404, 'HWID not banned');
    }

    return ban;
  }
}

export const banService = new BanService();
