import { PrismaClient } from '@prisma/client';
import { ApiError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

export class LoaderService {
  async getAllLoaders() {
    return await prisma.loader.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async getLoaderInfo(loaderId: number) {
    const loader = await prisma.loader.findUnique({
      where: { id: loaderId },
    });

    if (!loader) {
      throw new ApiError(404, 'Loader not found');
    }

    return loader;
  }

  async createLoader(name: string, version: string, file: string, requireFilenameMatch: boolean = false) {
    const loader = await prisma.loader.create({
      data: {
        name,
        version,
        file,
        requireFilenameMatch,
      },
    });

    logger.info('Loader created', { loaderId: loader.id, name });

    return loader;
  }

  async updateLoader(loaderId: number, data: { name?: string; version?: string; file?: string; requireFilenameMatch?: boolean; loaderHash?: string; enforceHashVerification?: boolean }) {
    const loader = await prisma.loader.findUnique({
      where: { id: loaderId },
    });

    if (!loader) {
      throw new ApiError(404, 'Loader not found');
    }

    const updated = await prisma.loader.update({
      where: { id: loaderId },
      data,
    });

    logger.info('Loader updated', { loaderId });

    return updated;
  }

  async updateLoaderVersion(loaderId: number, version: string) {
    const loader = await prisma.loader.findUnique({
      where: { id: loaderId },
    });

    if (!loader) {
      throw new ApiError(404, 'Loader not found');
    }

    const updated = await prisma.loader.update({
      where: { id: loaderId },
      data: { version },
    });

    logger.info('Loader version updated', { loaderId, version });

    return updated;
  }

  async deleteLoader(loaderId: number) {
    const loader = await prisma.loader.findUnique({
      where: { id: loaderId },
    });

    if (!loader) {
      throw new ApiError(404, 'Loader not found');
    }

    await prisma.loader.delete({
      where: { id: loaderId },
    });

    logger.info('Loader deleted', { loaderId, name: loader.name });
  }
}

export const loaderService = new LoaderService();
