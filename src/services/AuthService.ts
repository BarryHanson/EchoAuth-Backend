import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { generateJWT } from '../middleware/auth';
import { JWTPayload } from '../types';
import { ApiError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

export class AuthService {
  async registerUser(
    username: string,
    password: string,
    role: string = 'owner'
  ) {
    const existing = await prisma.user.findUnique({
      where: { username },
    });

    if (existing) {
      throw new ApiError(400, 'Username already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        role,
      },
    });

    // If registering as owner, create a default program
    if (role === 'owner') {
      const programSlug = username.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const apiSecret = `secret_${randomBytes(32).toString('hex')}`;

      await prisma.owner.create({
        data: {
          userId: user.id,
          programName: `${username}'s Program`,
          programSlug: programSlug + '-' + Date.now(), // Add timestamp to ensure uniqueness
          description: 'Default program created during registration',
          apiSecret,
        },
      });

      logger.info('Default program created for new owner', { userId: user.id, username });
    }

    logger.info('User registered', { username, role });

    return {
      id: user.id,
      username: user.username,
      role: user.role,
    };
  }

  async loginUser(username: string, password: string, hwid?: string, ip?: string) {
    const user = await prisma.user.findUnique({
      where: { username },
      include: {
        ownedPrograms: true,
        sellerProfile: true,
      },
    });

    if (!user) {
      throw new ApiError(401, 'Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      throw new ApiError(401, 'Invalid credentials');
    }

    // Timestamp drift detection
    const currentServerTimestamp = Date.now();
    const existingSession = await prisma.session.findFirst({
      where: { userId: user.id, isValid: true },
      orderBy: { createdAt: 'desc' },
    });

    if (existingSession && existingSession.lastServerTimestamp > 0) {
      const timeDriftMs = currentServerTimestamp - Number(existingSession.lastServerTimestamp);
      const maxAllowedBackwardDriftMs = 5 * 60 * 1000; // 5 minutes backward drift tolerance

      // If timestamp has moved backward beyond tolerance, flag as suspicious
      if (timeDriftMs < -maxAllowedBackwardDriftMs) {
        logger.warn('Clock rollback detected on login attempt', {
          userId: user.id,
          username,
          driftMs: timeDriftMs,
          lastTimestamp: Number(existingSession.lastServerTimestamp),
          currentTimestamp: currentServerTimestamp,
        });

        // Mark session as suspicious and invalid
        await prisma.session.update({
          where: { id: existingSession.id },
          data: { suspiciousActivity: true, isValid: false },
        });

        throw new ApiError(403, 'Suspicious activity detected: System clock tampering suspected. Please contact support.');
      }
    }

    // Get user's subscription and cheat to check lock settings
    const userKey = await prisma.userKey.findUnique({
      where: { userId: user.id },
    });

    if (userKey) {
      const key = await prisma.key.findUnique({
        where: { id: userKey.keyId },
      });

      if (key) {
        const cheat = await prisma.cheat.findUnique({
          where: { id: key.cheatId },
        });

        if (cheat) {
          // Check HWID lock if enabled on the cheat
          if (cheat.requireHwidLock && hwid && existingSession?.hwid && existingSession.hwid !== hwid) {
            logger.warn('HWID mismatch on login', { userId: user.id, username, cheatId: cheat.id, expectedHwid: existingSession.hwid, providedHwid: hwid });
            throw new ApiError(403, 'HWID does not match. This cheat requires HWID locking.');
          }

          // Check IP lock if enabled on the cheat
          if (cheat.requireIpLock && ip && existingSession?.ipAddress && existingSession.ipAddress !== ip) {
            logger.warn('IP mismatch on login', { userId: user.id, username, cheatId: cheat.id, expectedIp: existingSession.ipAddress, providedIp: ip });
            throw new ApiError(403, 'IP does not match. This cheat requires IP locking.');
          }
        }
      }
    }

    // Get ownerId based on role (for owners, use the first program)
    let ownerId: number | undefined;
    if (user.role === 'owner' && user.ownedPrograms) {
      const programs = Array.isArray(user.ownedPrograms) ? user.ownedPrograms : [user.ownedPrograms];
      if (programs.length > 0) {
        ownerId = programs[0].id;
      }
      logger.debug('Owner programs', { userId: user.id, programCount: programs.length, programs });
    } else if (user.role === 'seller' && user.sellerProfile) {
      ownerId = user.sellerProfile.ownerId;
    }

    const payload: JWTPayload = {
      userId: user.id,
      username: user.username,
      role: user.role,
      ...(ownerId && { ownerId }),
    };

    const token = generateJWT(payload);

    // Create session with HWID and IP locking if provided
    if (hwid && ip) {
      const { createHash } = await import('crypto');
      const sessionId = createHash('sha256').update(`${user.id}:${Date.now()}`).digest('hex');

      await prisma.session.create({
        data: {
          id: sessionId,
          userId: user.id,
          hwid,
          ipAddress: ip,
          userAgent: '',
          lastServerTimestamp: BigInt(currentServerTimestamp),
          expiresAt: new Date(currentServerTimestamp + 24 * 60 * 60 * 1000), // 24 hours
        },
      });

      // Also update the user's key with HWID and IP for dashboard display
      if (userKey) {
        await prisma.key.update({
          where: { id: userKey.keyId },
          data: {
            hwid,
            lastip: ip,
          },
        });
      }

      logger.info('Session created with HWID locking', { userId: user.id, username, hwid, ip, timestamp: currentServerTimestamp });
    }

    logger.info('User logged in', { username, role: user.role, ownerId, hwid, ip, hasOwnedPrograms: !!user.ownedPrograms });

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        ...(ownerId && { ownerId }),
      },
    };
  }

  async getUserInfo(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        ownedPrograms: true,
        sellerProfile: true,
      },
    });

    if (!user) {
      throw new ApiError(404, 'User not found');
    }

    // Get ownerId based on role (for owners, use the first program)
    let ownerId: number | undefined;
    if (user.role === 'owner' && user.ownedPrograms) {
      const programs = Array.isArray(user.ownedPrograms) ? user.ownedPrograms : [user.ownedPrograms];
      if (programs.length > 0) {
        ownerId = programs[0].id;
      }
    } else if (user.role === 'seller' && user.sellerProfile) {
      ownerId = user.sellerProfile.ownerId;
    }

    return {
      id: user.id,
      username: user.username,
      role: user.role,
      ...(ownerId && { ownerId }),
    };
  }

  async updatePassword(userId: number, oldPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new ApiError(404, 'User not found');
    }

    const passwordMatch = await bcrypt.compare(oldPassword, user.password);

    if (!passwordMatch) {
      throw new ApiError(401, 'Old password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    logger.info('Password updated', { userId });
  }
}

export const authService = new AuthService();
