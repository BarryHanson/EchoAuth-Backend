import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Store files in uploads directory (volume-mounted in Docker)
const FILE_STORAGE_DIR = '/app/uploads';
console.log(`[CHEAT FILE SERVICE] FILE_STORAGE_DIR resolved to: ${FILE_STORAGE_DIR}`);

export class CheatFileService {
  /**
   * Initialize file storage directory
   */
  static async initializeStorage() {
    try {
      console.log(`[STORAGE INIT] Creating directory: ${FILE_STORAGE_DIR}`);
      await fs.mkdir(FILE_STORAGE_DIR, { recursive: true });
      console.log(`[STORAGE INIT] Directory created successfully`);
    } catch (error) {
      console.error('[STORAGE INIT] Failed to create file storage directory:', error);
    }
  }

  /**
   * Upload a cheat file
   */
  static async uploadCheatFile(
    cheatId: number,
    fileBuffer: Buffer,
    originalFilename: string,
    ownerId: number
  ) {
    // Verify ownership
    const cheat = await prisma.cheat.findUnique({
      where: { id: cheatId },
    });

    if (!cheat || cheat.ownerId !== ownerId) {
      throw new Error('Unauthorized: Cannot upload file for this cheat');
    }

    // Calculate SHA-256 hash for integrity
    const contentHash = createHash('sha256').update(fileBuffer).digest('hex');

    // Generate secure filename (hash-based to prevent directory traversal)
    const secureFilename = `${cheatId}_${contentHash.substring(0, 16)}.bin`;
    const storedPath = path.join(FILE_STORAGE_DIR, secureFilename);

    console.log(`[FILE UPLOAD] Attempting to write file to: ${storedPath}`);
    console.log(`[FILE UPLOAD] File buffer size: ${fileBuffer.length}`);

    // Write file to disk
    await fs.writeFile(storedPath, fileBuffer);

    console.log(`[FILE UPLOAD] File written successfully`);

    // Delete old file if exists
    const existingFile = await prisma.cheatFile.findUnique({
      where: { cheatId },
    });

    if (existingFile) {
      try {
        await fs.unlink(path.join(FILE_STORAGE_DIR, path.basename(existingFile.storedPath)));
      } catch (error) {
        console.error('Failed to delete old file:', error);
      }

      await prisma.cheatFile.delete({
        where: { cheatId },
      });
    }

    // Create file record
    const cheatFile = await prisma.cheatFile.create({
      data: {
        cheatId,
        filename: originalFilename,
        storedPath: secureFilename,
        fileSize: BigInt(fileBuffer.length),
        contentHash,
      },
    });

    return {
      id: cheatFile.id,
      filename: cheatFile.filename,
      fileSize: cheatFile.fileSize.toString(),
      uploadedAt: cheatFile.createdAt,
    };
  }

  /**
   * Download a cheat file (returns buffer)
   */
  static async downloadCheatFile(cheatId: number, ownerId: number) {
    const cheatFile = await prisma.cheatFile.findUnique({
      where: { cheatId },
      include: { cheat: true },
    });

    if (!cheatFile) {
      throw new Error('File not found');
    }

    // Verify ownership
    if (cheatFile.cheat.ownerId !== ownerId) {
      throw new Error('Unauthorized: Cannot download this file');
    }

    // Read file from disk
    const filePath = path.join(FILE_STORAGE_DIR, cheatFile.storedPath);
    const fileBuffer = await fs.readFile(filePath);

    // Verify integrity
    const calculatedHash = createHash('sha256').update(fileBuffer).digest('hex');
    if (calculatedHash !== cheatFile.contentHash) {
      throw new Error('File integrity check failed');
    }

    // Update download tracking
    await prisma.cheatFile.update({
      where: { id: cheatFile.id },
      data: {
        lastDownloadedAt: new Date(),
        downloadCount: { increment: 1 },
      },
    });

    return {
      buffer: fileBuffer,
      filename: cheatFile.filename,
      size: cheatFile.fileSize,
      hash: cheatFile.contentHash,
      cheat_status: cheatFile.cheat.status,
    };
  }

  /**
   * Delete a cheat file
   */
  static async deleteCheatFile(cheatId: number, ownerId: number) {
    const cheatFile = await prisma.cheatFile.findUnique({
      where: { cheatId },
      include: { cheat: true },
    });

    if (!cheatFile) {
      throw new Error('File not found');
    }

    // Verify ownership
    if (cheatFile.cheat.ownerId !== ownerId) {
      throw new Error('Unauthorized: Cannot delete this file');
    }

    // Delete from disk
    try {
      await fs.unlink(path.join(FILE_STORAGE_DIR, cheatFile.storedPath));
    } catch (error) {
      console.error('Failed to delete file from disk:', error);
    }

    // Delete from database
    await prisma.cheatFile.delete({
      where: { id: cheatFile.id },
    });
  }

  /**
   * Get file info without downloading
   */
  static async getCheatFileInfo(cheatId: number, ownerId: number) {
    const cheatFile = await prisma.cheatFile.findUnique({
      where: { cheatId },
      include: { cheat: true },
    });

    if (!cheatFile) {
      return null;
    }

    // Verify ownership
    if (cheatFile.cheat.ownerId !== ownerId) {
      throw new Error('Unauthorized: Cannot access this file');
    }

    return {
      id: cheatFile.id,
      filename: cheatFile.filename,
      fileSize: cheatFile.fileSize.toString(),
      downloadCount: cheatFile.downloadCount,
      lastDownloadedAt: cheatFile.lastDownloadedAt,
      uploadedAt: cheatFile.createdAt,
    };
  }
}
