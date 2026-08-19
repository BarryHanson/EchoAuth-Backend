import { Router } from 'express';
import { clientController } from '../controllers/ClientController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.post('/auth', (req, res, next) =>
  clientController.authenticate(req, res, next)
);

router.get('/api-secret', authMiddleware, (req, res, next) =>
  clientController.getApiSecret(req, res, next)
);

router.post('/api-secret/regenerate', authMiddleware, (req, res, next) =>
  clientController.regenerateApiSecret(req, res, next)
);

router.post('/cheat-info', (req, res, next) =>
  clientController.getCheatInfo(req, res, next)
);

router.post('/download', authMiddleware, (req, res, next) =>
  clientController.downloadCheat(req, res, next)
);

router.post('/log', (req, res, next) =>
  clientController.submitLog(req, res, next)
);

router.post('/report', (req, res, next) =>
  clientController.reportCrack(req, res, next)
);

router.post('/loader/check-version', (req, res, next) =>
  clientController.checkLoaderVersion(req, res, next)
);

router.get('/loader/hash-info/:loaderId', (req, res, next) =>
  clientController.getLoaderHashInfo(req, res, next)
);

router.post('/submit-log', authMiddleware, (req, res, next) =>
  clientController.submitAuthLog(req, res, next)
);

router.post('/ban', authMiddleware, (req, res, next) =>
  clientController.banUserAndHwid(req, res, next)
);

export default router;
