import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

const MAX_BACKWARD_DRIFT_MS = 5 * 60 * 1000; // 5 minutes tolerance for backward drift

export class AntiTamperingService {
  /**
   * Validate and update timestamp for a session
   * Detects if client clock has been rolled back
   */
  static async validateSessionTimestamp(userId: number, clientTimestampMs?: number): Promise<boolean> {
    try {
      const session = await prisma.session.findFirst({
        where: { userId, isValid: true },
        orderBy: { createdAt: 'desc' },
      });

      if (!session) {
        // No existing session, this is fine
        return true;
      }

      const serverCurrentTimeMs = Date.now();
      const lastKnownTimestampMs = Number(session.lastServerTimestamp);

      // If we have no previous timestamp, accept this request
      if (lastKnownTimestampMs === 0) {
        return true;
      }

      const timeDriftMs = serverCurrentTimeMs - lastKnownTimestampMs;

      // Detect backward clock drift
      if (timeDriftMs < -MAX_BACKWARD_DRIFT_MS) {
        logger.warn('Clock rollback detected on API request', {
          userId,
          driftMs: timeDriftMs,
          maxAllowedMs: MAX_BACKWARD_DRIFT_MS,
          lastTimestamp: lastKnownTimestampMs,
          currentTimestamp: serverCurrentTimeMs,
        });

        // Mark session as suspicious
        await prisma.session.update({
          where: { id: session.id },
          data: { suspiciousActivity: true, isValid: false },
        });

        return false;
      }

      // Update the last known timestamp for future checks
      await prisma.session.update({
        where: { id: session.id },
        data: { lastServerTimestamp: BigInt(serverCurrentTimeMs) },
      });

      return true;
    } catch (error) {
      logger.error('Error validating session timestamp', { userId, error });
      return false;
    }
  }

  /**
   * Get flagged sessions with suspicious activity
   */
  static async getSuspiciousSessions(ownerId?: number) {
    try {
      const where = { suspiciousActivity: true };

      const suspiciousSessions = await prisma.session.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              username: true,
            },
          },
        },
        orderBy: { lastActivityAt: 'desc' },
      });

      return suspiciousSessions;
    } catch (error) {
      logger.error('Error fetching suspicious sessions', { error });
      return [];
    }
  }

  /**
   * Invalidate all sessions for a user (used when clock tampering is detected)
   */
  static async invalidateAllUserSessions(userId: number, reason: string = 'Clock tampering detected') {
    try {
      const updated = await prisma.session.updateMany({
        where: { userId },
        data: { isValid: false, suspiciousActivity: true },
      });

      logger.warn('All user sessions invalidated', { userId, reason, count: updated.count });
      return updated.count;
    } catch (error) {
      logger.error('Error invalidating user sessions', { userId, error });
      return 0;
    }
  }

  /**
   * Clear suspicious flag from a session after manual review
   */
  static async clearSuspiciousFlag(sessionId: string, ownerId: number) {
    try {
      const session = await prisma.session.update({
        where: { id: sessionId },
        data: { suspiciousActivity: false },
      });

      logger.info('Suspicious flag cleared', { sessionId, ownerId, userId: session.userId });
      return session;
    } catch (error) {
      logger.error('Error clearing suspicious flag', { sessionId, error });
      throw error;
    }
  }
}

export const antiTamperingService = new AntiTamperingService();
