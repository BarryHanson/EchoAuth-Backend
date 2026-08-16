import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient();

export interface SessionData {
  id: string;
  userId: number;
  ipAddress: string;
  userAgent: string;
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
  isValid: boolean;
}

export class SessionService {
  /**
   * Create a new session for a user
   */
  static async createSession(
    userId: number,
    ipAddress: string,
    userAgent: string
  ): Promise<SessionData> {
    const sessionId = createHash('sha256')
      .update(`${userId}-${ipAddress}-${Date.now()}`)
      .digest('hex');

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

    // Store session in database
    const session = await prisma.session.create({
      data: {
        id: sessionId,
        userId,
        ipAddress,
        userAgent,
        createdAt: now,
        lastActivityAt: now,
        expiresAt,
        isValid: true,
      },
    });

    return {
      id: session.id,
      userId: session.userId,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      expiresAt: session.expiresAt,
      isValid: session.isValid,
    };
  }

  /**
   * Validate session and check for suspicious activity
   */
  static async validateSession(
    sessionId: string,
    ipAddress: string
  ): Promise<{
    isValid: boolean;
    isSuspicious: boolean;
    reason?: string;
  }> {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      return { isValid: false, isSuspicious: true, reason: 'Session not found' };
    }

    if (new Date() > session.expiresAt) {
      return { isValid: false, isSuspicious: false, reason: 'Session expired' };
    }

    if (!session.isValid) {
      return { isValid: false, isSuspicious: false, reason: 'Session invalidated' };
    }

    // Check if IP changed (potential account sharing/compromise)
    if (session.ipAddress !== ipAddress) {
      return {
        isValid: true, // Allow but flag as suspicious
        isSuspicious: true,
        reason: 'IP address changed',
      };
    }

    // Update last activity
    await prisma.session.update({
      where: { id: sessionId },
      data: { lastActivityAt: new Date() },
    });

    return { isValid: true, isSuspicious: false };
  }

  /**
   * Invalidate a session (logout)
   */
  static async invalidateSession(sessionId: string): Promise<void> {
    await prisma.session.update({
      where: { id: sessionId },
      data: { isValid: false },
    });
  }

  /**
   * Check for suspicious login patterns
   */
  static async checkSuspiciousLogin(
    userId: number,
    ipAddress: string,
    userAgent: string
  ): Promise<{
    isSuspicious: boolean;
    reason?: string;
    requiresVerification: boolean;
  }> {
    // Get user's last login location
    const lastSession = await prisma.session.findFirst({
      where: { userId, isValid: true },
      orderBy: { createdAt: 'desc' },
    });

    if (lastSession && lastSession.ipAddress !== ipAddress) {
      // Different IP - check for rapid location change
      const timeSinceLastLogin = Date.now() - lastSession.createdAt.getTime();
      const minutesSinceLastLogin = timeSinceLastLogin / (1000 * 60);

      // If login from different IP within 5 minutes, it's suspicious
      if (minutesSinceLastLogin < 5) {
        return {
          isSuspicious: true,
          reason: 'Rapid login from different IP address',
          requiresVerification: true,
        };
      }
    }

    return {
      isSuspicious: false,
      requiresVerification: false,
    };
  }

  /**
   * Detect credential sharing (multiple IPs for same user within short time)
   */
  static async detectCredentialSharing(userId: number): Promise<boolean> {
    // Get all active sessions for this user in last 5 minutes
    const recentSessions = await prisma.session.findMany({
      where: {
        userId,
        isValid: true,
        createdAt: {
          gte: new Date(Date.now() - 5 * 60 * 1000),
        },
      },
    });

    // Check if multiple unique IPs
    const uniqueIPs = new Set(recentSessions.map(s => s.ipAddress));
    return uniqueIPs.size > 1;
  }

  /**
   * Ban a user for account sharing/abuse
   */
  static async banUserForAbuse(userId: number, reason: string): Promise<void> {
    // Invalidate all sessions for this user
    await prisma.session.updateMany({
      where: { userId },
      data: { isValid: false },
    });
  }
}
