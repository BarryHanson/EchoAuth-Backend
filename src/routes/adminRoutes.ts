import { Router } from 'express';
import multer from 'multer';
import { adminController } from '../controllers/AdminController';
import { cheatFileController } from '../controllers/CheatFileController';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { timestampValidationMiddleware } from '../middleware/timestampValidation';
import { keyGenerationLimiter, downloadLimiter } from '../middleware/rateLimiter';

const router = Router();

// Multer configuration for file uploads (store in memory for security)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
});

router.use(authMiddleware, timestampValidationMiddleware, adminMiddleware);

router.post('/keys/generate', keyGenerationLimiter, (req, res, next) =>
  adminController.generateKey(req, res, next)
);

router.get('/keys', (req, res, next) =>
  adminController.getAllKeys(req, res, next)
);

router.post('/keys/ban', (req, res, next) =>
  adminController.banKey(req, res, next)
);

router.post('/keys/unban', (req, res, next) =>
  adminController.unbanKey(req, res, next)
);

router.delete('/keys', (req, res, next) =>
  adminController.deleteKey(req, res, next)
);

router.post('/keys/reset-hwid', (req, res, next) =>
  adminController.resetHwid(req, res, next)
);

router.post('/cheats', (req, res, next) =>
  adminController.createCheat(req, res, next)
);

router.get('/cheats', (req, res, next) =>
  adminController.getAllCheats(req, res, next)
);

router.put('/cheats/:id/status', (req, res, next) =>
  adminController.updateCheatStatus(req, res, next)
);

router.put('/cheats/:id', (req, res, next) =>
  adminController.updateCheat(req, res, next)
);

router.delete('/cheats/:id', (req, res, next) =>
  adminController.deleteCheat(req, res, next)
);

router.get('/logs', (req, res, next) =>
  adminController.getAllLogs(req, res, next)
);

router.get('/bans', (req, res, next) =>
  adminController.getAllBans(req, res, next)
);

router.post('/bans', (req, res, next) =>
  adminController.banHwid(req, res, next)
);

router.delete('/bans/:hwid', (req, res, next) =>
  adminController.unbanHwid(req, res, next)
);

router.get('/stats', (req, res, next) =>
  adminController.getKeyStats(req, res, next)
);

router.get('/users', (req, res, next) =>
  adminController.getAllUsers(req, res, next)
);

router.post('/users/delete', (req, res, next) =>
  adminController.deleteUser(req, res, next)
);

router.get('/loaders', (req, res, next) =>
  adminController.getAllLoaders(req, res, next)
);

router.post('/loaders/create', (req, res, next) =>
  adminController.createLoader(req, res, next)
);

router.post('/loaders/update-version', (req, res, next) =>
  adminController.updateLoaderVersion(req, res, next)
);

router.put('/loaders/:loaderId', (req, res, next) =>
  adminController.updateLoader(req, res, next)
);

router.get('/seller/info', (req, res, next) =>
  adminController.getSellerInfo(req, res, next)
);

router.delete('/program', (req, res, next) =>
  adminController.deleteProgram(req, res, next)
);

router.get('/program/:ownerId/sellers', (req, res, next) =>
  adminController.getProgramSellers(req, res, next)
);

router.post('/seller/quota', (req, res, next) =>
  adminController.updateSellerQuota(req, res, next)
);

router.post('/seller/toggle-active', (req, res, next) =>
  adminController.toggleSellerActive(req, res, next)
);

router.post('/seller/reset-keys', (req, res, next) =>
  adminController.resetSellerKeyCount(req, res, next)
);

router.delete('/seller', (req, res, next) =>
  adminController.deleteSeller(req, res, next)
);

// Cheat file operations
router.post('/cheats/:cheatId/file', upload.single('file'), (req, res, next) =>
  cheatFileController.uploadCheatFile(req, res, next)
);

router.get('/cheats/:cheatId/file', downloadLimiter, (req, res, next) =>
  cheatFileController.downloadCheatFile(req, res, next)
);

router.get('/cheats/:cheatId/file/info', (req, res, next) =>
  cheatFileController.getCheatFileInfo(req, res, next)
);

router.delete('/cheats/:cheatId/file', (req, res, next) =>
  cheatFileController.deleteCheatFile(req, res, next)
);

export default router;
