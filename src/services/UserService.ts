import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { ApiError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

export class UserService {
  async getAllUsers() {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return users;
  }

  async deleteUser(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new ApiError(404, 'User not found');
    }

    if (user.username === 'Admin') {
      throw new ApiError(400, 'Cannot delete default admin user');
    }

    await prisma.user.delete({
      where: { id: userId },
    });

    logger.info('User deleted', { userId, username: user.username });
  }

  async deleteUserByUsername(username: string) {
    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      throw new ApiError(404, 'User not found');
    }

    if (user.username === 'Admin') {
      throw new ApiError(400, 'Cannot delete default admin user');
    }

    await prisma.user.delete({
      where: { username },
    });

    logger.info('User deleted', { username });
  }
}

export const userService = new UserService();
