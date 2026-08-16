import { PrismaClient } from '@prisma/client';
import { ApiError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import crypto from 'crypto';

const prisma = new PrismaClient();

export class RegistrationService {
  /**
   * Generate a unique registration token for user or seller
   */
  async generateToken(
    ownerId: number,
    type: 'user' | 'seller',
    keyId?: number,
    maxKeysLimit?: number
  ): Promise<{ token: string; id: number }> {
    // Verify owner exists
    const owner = await prisma.owner.findUnique({
      where: { id: ownerId },
    });

    if (!owner) {
      throw new ApiError(404, 'Owner not found');
    }

    // For user registrations, keyId is optional (users can enter their key during registration)

    // Verify key exists if provided
    if (keyId) {
      const key = await prisma.key.findUnique({
        where: { id: keyId },
      });

      if (!key || key.ownerId !== ownerId) {
        throw new ApiError(404, 'Key not found or does not belong to this owner');
      }

      // Check if key is already registered
      const existingToken = await prisma.registrationToken.findUnique({
        where: { keyId },
      });

      if (existingToken && existingToken.isUsed) {
        throw new ApiError(400, 'This key is already registered');
      }
    }

    // Generate unique token
    const token = crypto.randomBytes(32).toString('hex');

    // Create registration token
    const registrationToken = await prisma.registrationToken.create({
      data: {
        token,
        type,
        ownerId,
        keyId: keyId || null,
        maxKeysLimit: maxKeysLimit || (type === 'seller' ? 100 : 0),
        canResetHWID: type === 'seller',
        canGenerateKeys: type === 'seller',
      },
    });

    logger.info('Registration token generated', {
      tokenId: registrationToken.id,
      type,
      ownerId,
      keyId,
    });

    return {
      token: registrationToken.token,
      id: registrationToken.id,
    };
  }

  /**
   * Get registration token details
   */
  async getTokenDetails(token: string) {
    const regToken = await prisma.registrationToken.findUnique({
      where: { token },
      include: {
        key: {
          select: {
            id: true,
            key: true,
            subscribe: true,
            subscribeend: true,
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

    if (!regToken) {
      throw new ApiError(404, 'Registration token not found or expired');
    }

    if (regToken.isUsed) {
      throw new ApiError(400, 'This registration token has already been used');
    }

    if (regToken.expiresAt && regToken.expiresAt < new Date()) {
      throw new ApiError(400, 'This registration token has expired');
    }

    return regToken;
  }

  /**
   * Validate and use registration token for user signup
   */
  async validateUserToken(token: string, keyString: string) {
    const regToken = await this.getTokenDetails(token);

    if (regToken.type !== 'user') {
      throw new ApiError(400, 'This token is not for user registration');
    }

    // For general user registration links, the token may not have a pre-assigned key
    // Instead, validate that the key the user provides exists and belongs to this owner
    const key = await prisma.key.findUnique({
      where: { key: keyString },
    });

    if (!key) {
      throw new ApiError(400, 'Key not found');
    }

    if (key.ownerId !== regToken.owner.id) {
      throw new ApiError(400, 'Key does not belong to this program');
    }

    if (key.status !== 'waiting') {
      throw new ApiError(400, 'Key is not available for registration');
    }

    // Check if key is already linked to another user
    const existingUserKey = await prisma.userKey.findUnique({
      where: { keyId: key.id },
    });

    if (existingUserKey) {
      throw new ApiError(400, 'This key is already linked to another account');
    }

    // Return token with the validated key attached
    return {
      ...regToken,
      key: {
        id: key.id,
        key: key.key,
        subscribe: key.subscribe,
        subscribeend: key.subscribeend,
      },
    };
  }

  /**
   * Validate and use registration token for seller signup
   */
  async validateSellerToken(token: string) {
    const regToken = await this.getTokenDetails(token);

    if (regToken.type !== 'seller') {
      throw new ApiError(400, 'This token is not for seller registration');
    }

    return regToken;
  }

  /**
   * Mark token as used after successful registration
   */
  async markTokenAsUsed(tokenId: number, userId: number) {
    const token = await prisma.registrationToken.update({
      where: { id: tokenId },
      data: {
        isUsed: true,
        usedAt: new Date(),
        usedById: userId,
      },
    });

    logger.info('Registration token marked as used', {
      tokenId,
      userId,
    });

    return token;
  }

  /**
   * Get all registration tokens for an owner
   */
  async getOwnerTokens(ownerId: number, type?: 'user' | 'seller') {
    const tokens = await prisma.registrationToken.findMany({
      where: {
        ownerId,
        ...(type && { type }),
      },
      include: {
        key: {
          select: {
            id: true,
            key: true,
            subscribe: true,
          },
        },
        owner: {
          select: {
            programSlug: true,
            programName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return tokens.map((t) => ({
      id: t.id,
      token: t.token,
      type: t.type,
      isUsed: t.isUsed,
      usedAt: t.usedAt,
      expiresAt: t.expiresAt,
      key: t.key ? {
        id: t.key.id,
        key: t.key.key,
        subscribe: t.key.subscribe.toString(),
      } : undefined,
      maxKeysLimit: t.type === 'seller' ? t.maxKeysLimit : undefined,
      programSlug: t.owner.programSlug,
      createdAt: t.createdAt,
    }));
  }

  /**
   * Delete a registration token
   */
  async deleteToken(tokenId: number, ownerId: number) {
    const token = await prisma.registrationToken.findUnique({
      where: { id: tokenId },
    });

    if (!token || token.ownerId !== ownerId) {
      throw new ApiError(404, 'Token not found');
    }

    if (token.isUsed) {
      throw new ApiError(400, 'Cannot delete an already used token');
    }

    await prisma.registrationToken.delete({
      where: { id: tokenId },
    });

    logger.info('Registration token deleted', { tokenId });
  }

  /**
   * Get program info by slug (for user registration without token)
   */
  async getProgramBySlug(slug: string) {
    const program = await prisma.owner.findUnique({
      where: { programSlug: slug },
      select: {
        id: true,
        programName: true,
        programSlug: true,
      },
    });

    if (!program) {
      throw new ApiError(404, 'Program not found');
    }

    return program;
  }

  /**
   * Link a key to a user without token (for users registering with just a key)
   */
  async linkKeyToUser(keyString: string, userId: number, programSlug: string) {
    // Verify program exists
    const program = await this.getProgramBySlug(programSlug);

    // Find the key
    const key = await prisma.key.findUnique({
      where: { key: keyString },
    });

    if (!key) {
      throw new ApiError(400, 'Key not found');
    }

    if (key.ownerId !== program.id) {
      throw new ApiError(400, 'Key does not belong to this program');
    }

    if (key.status !== 'waiting') {
      throw new ApiError(400, 'Key is not available for registration');
    }

    // Check if key is already linked
    const existingUserKey = await prisma.userKey.findUnique({
      where: { keyId: key.id },
    });

    if (existingUserKey) {
      throw new ApiError(400, 'This key is already linked to another account');
    }

    // Link key to user (activatedAt and expiresAt remain null until activation)
    return await prisma.userKey.create({
      data: {
        userId,
        keyId: key.id,
        ownerId: program.id,
      },
    });
  }
}

export const registrationService = new RegistrationService();
