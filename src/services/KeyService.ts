import { PrismaClient } from '@prisma/client';
import { ApiError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { generateToken } from '../utils/encryption';

const prisma = new PrismaClient();

// Temporary: For now we'll use ownerId = 1 (default/God owner)
const DEFAULT_OWNER_ID = 1;

export class KeyService {
  async generateKey(key: string, username: string, cheatId: number | null | undefined, days: number, ownerId: number = DEFAULT_OWNER_ID) {
    const existing = await prisma.key.findUnique({
      where: { key },
    });

    if (existing) {
      throw new ApiError(400, 'Key already exists');
    }

    // Validate cheat if provided
    if (cheatId) {
      const cheat = await prisma.cheat.findUnique({
        where: { id: cheatId },
      });

      if (!cheat) {
        throw new ApiError(404, 'Cheat not found');
      }
    }

    const subscribeTime = days * 86400;

    const newKey = await prisma.key.create({
      data: {
        key,
        status: 'waiting',
        subscribe: BigInt(subscribeTime),
        cheatId: cheatId || 1, // Default to cheat 1 if not specified
        creator: username,
        ownerId,
      },
    });

    logger.info('Key generated', { key, username, cheatId, days, ownerId });

    return {
      id: newKey.id,
      key: newKey.key,
      status: newKey.status,
    };
  }

  async authenticateKey(key: string, hwid: string, ipAddress: string) {
    const keyData = await prisma.key.findUnique({
      where: { key },
    });

    if (!keyData) {
      throw new ApiError(404, 'Key not found');
    }

    if (keyData.status === 'banned') {
      throw new ApiError(403, 'Key is banned');
    }

    const hwidBan = await prisma.hWID.findUnique({
      where: { hwid_ownerId: { hwid, ownerId: keyData.ownerId } },
    });

    if (hwidBan) {
      await this.banKey(key, 'HWID found in blacklist', keyData.ownerId);
      throw new ApiError(403, 'HWID is banned');
    }

    const cheat = await prisma.cheat.findUnique({
      where: { id: keyData.cheatId },
    });

    if (!cheat) {
      throw new ApiError(404, 'Cheat not found');
    }

    if (cheat.status === 'freezed') {
      throw new ApiError(403, 'Cheat is frozen');
    }

    if (keyData.status === 'waiting') {
      const endTime = BigInt(Math.floor(Date.now() / 1000)) + keyData.subscribe;

      await prisma.key.update({
        where: { id: keyData.id },
        data: {
          hwid,
          status: 'activated',
          subscribeend: endTime,
          firstip: ipAddress,
        },
      });

      const token = generateToken(key, hwid);
      logger.info('Key activated', { key, hwid });

      return { status: 'success', token };
    }

    if (keyData.hwid !== hwid) {
      throw new ApiError(403, 'HWID mismatch');
    }

    const now = BigInt(Math.floor(Date.now() / 1000));
    if (keyData.subscribeend && keyData.subscribeend <= now) {
      await this.expireKey(key);
      throw new ApiError(403, 'Subscription expired');
    }

    await prisma.key.update({
      where: { id: keyData.id },
      data: { lastip: ipAddress },
    });

    const token = generateToken(key, hwid);
    logger.info('Key authenticated', { key, hwid });

    return { status: 'success', token };
  }

  async getKeyInfo(key: string) {
    const keyData = await prisma.key.findUnique({
      where: { key },
    });

    if (!keyData) {
      throw new ApiError(404, 'Key not found');
    }

    return {
      id: keyData.id,
      key: keyData.key,
      hwid: keyData.hwid,
      status: keyData.status,
      subscribe: keyData.subscribe.toString(),
      subscribeend: keyData.subscribeend?.toString(),
      cheatId: keyData.cheatId,
      firstip: keyData.firstip,
      lastip: keyData.lastip,
      creator: keyData.creator,
      banreason: keyData.banreason,
      ownerId: keyData.ownerId,
    };
  }

  async getAllKeys(username?: string, ownerId: number = DEFAULT_OWNER_ID) {
    let keys;

    if (username && username.trim()) {
      // Filter by creator when username is provided (for sellers and role-based filtering)
      logger.info('Filtering keys by creator', { creator: username, ownerId });
      keys = await prisma.key.findMany({
        where: {
          creator: username,
          ownerId
        },
        include: {
          userKey: {
            include: {
              user: {
                select: { username: true }
              }
            }
          }
        }
      });
      logger.info('Keys returned after creator filter', { count: keys.length, creator: username, ownerId });
    } else {
      // No creator filter - show all keys for the owner (for gods and owners)
      logger.info('No creator filter - showing all keys', { ownerId });
      keys = await prisma.key.findMany({
        where: { ownerId },
        include: {
          userKey: {
            include: {
              user: {
                select: { username: true }
              }
            }
          }
        }
      });
      logger.info('Keys returned without filter', { count: keys.length, ownerId });
    }

    return keys.map((k) => {
      // Calculate expiresAt: if key has a userKey with expiresAt, use that; otherwise use subscribeend
      let expiresAt = null;
      if (k.userKey?.expiresAt) {
        expiresAt = k.userKey.expiresAt;
      } else if (k.subscribeend) {
        expiresAt = new Date(Number(k.subscribeend) * 1000);
      }

      return {
        ...k,
        subscribe: k.subscribe.toString(),
        subscribeend: k.subscribeend?.toString(),
        registeredUser: k.userKey?.user?.username || null,
        createdAt: k.createdAt || new Date(),
        expiresAt,
      };
    });
  }

  async banKey(key: string, reason: string, ownerId: number = DEFAULT_OWNER_ID) {
    const keyData = await prisma.key.findUnique({
      where: { key },
    });

    if (!keyData) {
      throw new ApiError(404, 'Key not found');
    }

    if (keyData.ownerId !== ownerId) {
      throw new ApiError(403, 'Unauthorized');
    }

    await prisma.key.update({
      where: { id: keyData.id },
      data: { status: 'banned', banreason: reason },
    });

    logger.info('Key banned', { key, reason, ownerId });
  }

  async unbanKey(key: string, ownerId: number = DEFAULT_OWNER_ID) {
    const keyData = await prisma.key.findUnique({
      where: { key },
    });

    if (!keyData) {
      throw new ApiError(404, 'Key not found');
    }

    if (keyData.ownerId !== ownerId) {
      throw new ApiError(403, 'Unauthorized');
    }

    await prisma.key.update({
      where: { id: keyData.id },
      data: { status: 'activated', banreason: null },
    });

    logger.info('Key unbanned', { key, ownerId });
  }

  async deleteKey(keyId: number, ownerId: number = DEFAULT_OWNER_ID) {
    const keyData = await prisma.key.findUnique({
      where: { id: keyId },
    });

    if (!keyData) {
      throw new ApiError(404, 'Key not found');
    }

    if (keyData.ownerId !== ownerId) {
      throw new ApiError(403, 'Unauthorized');
    }

    await prisma.key.delete({
      where: { id: keyId },
    });

    logger.info('Key deleted', { keyId, key: keyData.key, ownerId });
  }

  async expireKey(key: string) {
    const keyData = await prisma.key.findUnique({
      where: { key },
    });

    if (!keyData) {
      throw new ApiError(404, 'Key not found');
    }

    await prisma.key.update({
      where: { id: keyData.id },
      data: { status: 'ended' },
    });

    logger.info('Key expired', { key });
  }

  async resetHwid(key: string, ownerId: number = DEFAULT_OWNER_ID) {
    const keyData = await prisma.key.findUnique({
      where: { key },
    });

    if (!keyData) {
      throw new ApiError(404, 'Key not found');
    }

    if (keyData.ownerId !== ownerId) {
      throw new ApiError(403, 'Unauthorized');
    }

    await prisma.key.update({
      where: { id: keyData.id },
      data: { hwid: null },
    });

    logger.info('HWID reset', { key, ownerId });
  }

  async getKeyStats(ownerId: number = DEFAULT_OWNER_ID) {
    const total = await prisma.key.count({
      where: { ownerId },
    });
    const activated = await prisma.key.count({
      where: { status: 'activated', ownerId },
    });
    const banned = await prisma.key.count({
      where: { status: 'banned', ownerId },
    });

    return { total, activated, banned };
  }
}

export const keyService = new KeyService();
