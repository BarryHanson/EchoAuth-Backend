import { PrismaClient } from '@prisma/client';
import { ApiError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

export class CheatService {
  async createCheat(
    name: string,
    filename: string,
    process: string,
    injection: string,
    external: boolean,
    creator: string,
    ownerId: number
  ) {
    const cheat = await prisma.cheat.create({
      data: {
        name,
        filename,
        process,
        injection,
        external,
        creator,
        status: 'Undetected',
        ownerId,
      },
    });

    logger.info('Cheat created', { cheatId: cheat.id, name, ownerId });

    return cheat;
  }

  async getCheatInfo(cheatId: number, ownerId: number) {
    const cheat = await prisma.cheat.findUnique({
      where: { id: cheatId },
    });

    if (!cheat || cheat.ownerId !== ownerId) {
      throw new ApiError(404, 'Cheat not found');
    }

    return cheat;
  }

  async getAllCheats(ownerId: number) {
    return await prisma.cheat.findMany({
      where: { ownerId },
    });
  }

  async updateCheatStatus(cheatId: number, status: string, ownerId: number ) {
    const cheat = await prisma.cheat.findUnique({
      where: { id: cheatId },
    });

    if (!cheat || cheat.ownerId !== ownerId) {
      throw new ApiError(404, 'Cheat not found');
    }

    const updated = await prisma.cheat.update({
      where: { id: cheatId },
      data: { status },
    });

    logger.info('Cheat status updated', { cheatId, status, ownerId });

    return updated;
  }

  async deleteCheat(cheatId: number, ownerId: number) {
    const cheat = await prisma.cheat.findUnique({
      where: { id: cheatId },
    });

    if (!cheat || cheat.ownerId !== ownerId) {
      throw new ApiError(404, 'Cheat not found');
    }

    await prisma.cheat.delete({
      where: { id: cheatId },
    });

    logger.info('Cheat deleted', { cheatId, name: cheat.name, ownerId });
  }

  async downloadCheatFile(cheatId: number, key: string, hwid: string, ownerId: number) {
    const cheat = await prisma.cheat.findUnique({
      where: { id: cheatId },
    });

    if (!cheat || cheat.ownerId !== ownerId) {
      throw new ApiError(404, 'Cheat not found');
    }

    const filePath = path.join(process.cwd(), 'files', cheat.filename);

    if (!fs.existsSync(filePath)) {
      throw new ApiError(404, 'File not found');
    }

    logger.info('Cheat file downloaded', { cheatId, key, hwid, ownerId });

    return filePath;
  }

  async uploadCheatFile(cheatId: number, filePath: string, ownerId: number) {
    const cheat = await prisma.cheat.findUnique({
      where: { id: cheatId },
    });

    if (!cheat || cheat.ownerId !== ownerId) {
      throw new ApiError(404, 'Cheat not found');
    }

    const filesDir = path.join(process.cwd(), 'files');
    if (!fs.existsSync(filesDir)) {
      fs.mkdirSync(filesDir, { recursive: true });
    }

    logger.info('Cheat file uploaded', { cheatId, filename: cheat.filename, ownerId });
  }
}

export const cheatService = new CheatService();
