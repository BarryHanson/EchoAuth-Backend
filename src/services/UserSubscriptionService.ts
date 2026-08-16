import { PrismaClient } from '@prisma/client';
import { ApiError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

export class UserSubscriptionService {
  /**
   * Register a user with their purchased key
   */
  async registerUserWithKey(userId: number, keyId: number, ownerId: number) {
    // Verify key exists and belongs to owner
    const key = await prisma.key.findUnique({
      where: { id: keyId },
    });

    if (!key || key.ownerId !== ownerId) {
      throw new ApiError(404, 'Key not found');
    }

    // Check if key is already registered
    const existingUserKey = await prisma.userKey.findUnique({
      where: { keyId },
    });

    if (existingUserKey) {
      throw new ApiError(400, 'This key is already registered to another user');
    }

    // Create user-key relationship
    const userKey = await prisma.userKey.create({
      data: {
        userId,
        keyId,
        ownerId,
        activatedAt: new Date(),
        expiresAt: key.subscribeend ? new Date(Number(key.subscribeend) * 1000) : null,
      },
    });

    logger.info('User registered with key', { userId, keyId, ownerId });

    return userKey;
  }

  /**
   * Get user's subscription information
   */
  async getUserSubscription(userId: number) {
    const userKey = await prisma.userKey.findUnique({
      where: { userId },
      include: {
        key: {
          select: {
            id: true,
            key: true,
            status: true,
            subscribe: true,
            subscribeend: true,
            hwid: true,
            lastip: true,
          },
        },
        owner: {
          select: {
            id: true,
            programName: true,
            programSlug: true,
          },
        },
      },
    });

    if (!userKey) {
      throw new ApiError(404, 'No active subscription found');
    }

    // Calculate remaining time
    const now = Math.floor(Date.now() / 1000);
    const expiresAtMs = userKey.expiresAt ? new Date(userKey.expiresAt).getTime() : null;
    const expiresAtSeconds = expiresAtMs ? Math.floor(expiresAtMs / 1000) : null;
    const remainingSeconds = expiresAtSeconds ? Math.max(0, expiresAtSeconds - now) : null;
    const remainingDays = remainingSeconds ? Math.ceil(remainingSeconds / 86400) : null;

    // Calculate reset cooldowns
    const calculateCooldown = (lastReset: Date | null): { canReset: boolean; hoursRemaining: number } => {
      if (!lastReset) {
        return { canReset: true, hoursRemaining: 0 };
      }
      const now = new Date();
      const hoursSinceReset = (now.getTime() - new Date(lastReset).getTime()) / (1000 * 60 * 60);
      const canReset = hoursSinceReset >= 24;
      const hoursRemaining = Math.max(0, Math.ceil(24 - hoursSinceReset));
      return { canReset, hoursRemaining };
    };

    const hwidReset = calculateCooldown(userKey.lastHwidReset);
    const ipReset = calculateCooldown(userKey.lastIpReset);

    // Get the latest session with HWID and IP locking
    const latestSession = await prisma.session.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        hwid: true,
        ipAddress: true,
        createdAt: true,
      },
    });

    return {
      id: userKey.id,
      keyId: userKey.keyId,
      program: userKey.owner,
      key: {
        id: userKey.key.id,
        keyValue: userKey.key.key,
        status: userKey.key.status,
        hwid: userKey.key.hwid,
        lastIp: userKey.key.lastip,
      },
      subscription: {
        activatedAt: userKey.activatedAt,
        expiresAt: userKey.expiresAt,
        remainingDays,
        remainingSeconds,
        isActive: remainingSeconds ? remainingSeconds > 0 : false,
      },
      session: latestSession ? {
        hwid: latestSession.hwid,
        ipAddress: latestSession.ipAddress,
        boundAt: latestSession.createdAt,
      } : null,
      resets: {
        hwid: {
          lastReset: userKey.lastHwidReset,
          canReset: hwidReset.canReset,
          hoursRemaining: hwidReset.hoursRemaining,
        },
        ip: {
          lastReset: userKey.lastIpReset,
          canReset: ipReset.canReset,
          hoursRemaining: ipReset.hoursRemaining,
        },
      },
    };
  }

  /**
   * Get all users for an owner
   */
  async getOwnerUsers(ownerId: number) {
    const userKeys = await prisma.userKey.findMany({
      where: { ownerId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
          },
        },
        key: {
          select: {
            key: true,
            status: true,
            subscribeend: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return userKeys.map((uk) => {
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = uk.key.subscribeend ? Number(uk.key.subscribeend) : null;
      const remainingSeconds = expiresAt ? Math.max(0, expiresAt - now) : null;

      return {
        id: uk.id,
        user: uk.user,
        key: uk.key.key,
        status: uk.key.status,
        activatedAt: uk.activatedAt,
        expiresAt: uk.expiresAt,
        isActive: remainingSeconds ? remainingSeconds > 0 : false,
      };
    });
  }

  /**
   * Revoke a user's subscription
   */
  async revokeUserSubscription(userKeyId: number, ownerId: number) {
    const userKey = await prisma.userKey.findUnique({
      where: { id: userKeyId },
    });

    if (!userKey || userKey.ownerId !== ownerId) {
      throw new ApiError(404, 'User subscription not found');
    }

    // Delete the user-key relationship
    await prisma.userKey.delete({
      where: { id: userKeyId },
    });

    logger.info('User subscription revoked', { userKeyId, ownerId });
  }

  /**
   * Check if user has active subscription
   */
  async hasActiveSubscription(userId: number): Promise<boolean> {
    const userKey = await prisma.userKey.findUnique({
      where: { userId },
      include: {
        key: {
          select: {
            subscribeend: true,
          },
        },
      },
    });

    if (!userKey) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = userKey.key.subscribeend ? Number(userKey.key.subscribeend) : null;

    if (!expiresAt) {
      return true; // No expiration means active
    }

    return expiresAt > now;
  }

  /**
   * Activate a user's subscription
   */
  async activateSubscription(userId: number) {
    const userKey = await prisma.userKey.findUnique({
      where: { userId },
      include: { key: true },
    });

    if (!userKey) {
      throw new ApiError(404, 'User subscription not found');
    }

    if (userKey.activatedAt) {
      throw new ApiError(400, 'Subscription is already activated');
    }

    // Calculate expiry based on key's subscribe duration
    const now = new Date();
    const subscribeDays = Number(userKey.key.subscribe) / 86400;
    const expiresAt = new Date(now.getTime() + subscribeDays * 24 * 60 * 60 * 1000);

    // Update both UserKey and Key status
    const [updated] = await Promise.all([
      prisma.userKey.update({
        where: { id: userKey.id },
        data: {
          activatedAt: now,
          expiresAt,
        },
      }),
      prisma.key.update({
        where: { id: userKey.keyId },
        data: {
          status: 'activated',
        },
      }),
    ]);

    logger.info('Subscription activated', { userId, expiresAt, keyId: userKey.keyId });
    return updated;
  }

  /**
   * Reset HWID (24-hour cooldown)
   */
  async resetHwid(userId: number) {
    const userKey = await prisma.userKey.findUnique({
      where: { userId },
      include: { key: true },
    });

    if (!userKey) {
      throw new ApiError(404, 'User subscription not found');
    }

    // Check cooldown
    if (userKey.lastHwidReset) {
      const now = new Date();
      const lastReset = new Date(userKey.lastHwidReset);
      const hoursSinceReset = (now.getTime() - lastReset.getTime()) / (1000 * 60 * 60);

      if (hoursSinceReset < 24) {
        const hoursRemaining = Math.ceil(24 - hoursSinceReset);
        throw new ApiError(
          429,
          `HWID reset is on cooldown. Try again in ${hoursRemaining} hour${hoursRemaining !== 1 ? 's' : ''}`
        );
      }
    }

    // Reset HWID in Key table and all user sessions
    await Promise.all([
      prisma.key.update({
        where: { id: userKey.keyId },
        data: { hwid: null },
      }),
      prisma.session.updateMany({
        where: { userId },
        data: { hwid: null },
      }),
    ]);

    // Update last reset time
    const updated = await prisma.userKey.update({
      where: { id: userKey.id },
      data: { lastHwidReset: new Date() },
    });

    logger.info('HWID reset', { userId });
    return updated;
  }

  /**
   * Reset IP (24-hour cooldown)
   */
  async resetIp(userId: number) {
    const userKey = await prisma.userKey.findUnique({
      where: { userId },
      include: { key: true },
    });

    if (!userKey) {
      throw new ApiError(404, 'User subscription not found');
    }

    // Check cooldown
    if (userKey.lastIpReset) {
      const now = new Date();
      const lastReset = new Date(userKey.lastIpReset);
      const hoursSinceReset = (now.getTime() - lastReset.getTime()) / (1000 * 60 * 60);

      if (hoursSinceReset < 24) {
        const hoursRemaining = Math.ceil(24 - hoursSinceReset);
        throw new ApiError(
          429,
          `IP reset is on cooldown. Try again in ${hoursRemaining} hour${hoursRemaining !== 1 ? 's' : ''}`
        );
      }
    }

    // Reset IP in Key table and delete all user sessions (they'll create new ones on next login)
    await Promise.all([
      prisma.key.update({
        where: { id: userKey.keyId },
        data: { lastip: null },
      }),
      prisma.session.deleteMany({
        where: { userId },
      }),
    ]);

    // Update last reset time
    const updated = await prisma.userKey.update({
      where: { id: userKey.id },
      data: { lastIpReset: new Date() },
    });

    logger.info('IP reset', { userId });
    return updated;
  }
}

export const userSubscriptionService = new UserSubscriptionService();
