import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

const DEFAULT_OWNER_ID = 1;

export class LogService {
  async createLog(hwid: string, key: string | null, message: string, ip: string, ownerId?: number | null) {
    const logEntry = await prisma.log.create({
      data: {
        hwid,
        key,
        message,
        ip,
        ownerId: ownerId || null,
      },
    });

    logger.debug('Log created', { logId: logEntry.id, key, hwid, ownerId });

    return logEntry;
  }

  async getAllLogs(limit = 100, offset = 0, ownerId: number = DEFAULT_OWNER_ID) {
    const logs = await prisma.log.findMany({
      where: { ownerId },
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    });

    const total = await prisma.log.count({
      where: { ownerId },
    });

    return { logs, total };
  }

  async getLogsByKey(key: string, limit = 50, ownerId: number = DEFAULT_OWNER_ID) {
    return await prisma.log.findMany({
      where: { key, ownerId },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getLogsByHwid(hwid: string, limit = 50, ownerId: number = DEFAULT_OWNER_ID) {
    return await prisma.log.findMany({
      where: { hwid, ownerId },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteLogs(days: number, ownerId: number = DEFAULT_OWNER_ID) {
    const cutoffDate = new Date(Date.now() - days * 86400000);

    const result = await prisma.log.deleteMany({
      where: {
        ownerId,
        createdAt: {
          lt: cutoffDate,
        },
      },
    });

    logger.info('Old logs deleted', { count: result.count, days, ownerId });

    return result.count;
  }
}

export const logService = new LogService();
