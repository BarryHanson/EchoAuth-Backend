import { Router } from 'express';
import { authController } from '../controllers/AuthController';
import { authMiddleware } from '../middleware/auth';
import { timestampValidationMiddleware } from '../middleware/timestampValidation';
import { handleValidationErrors } from '../middleware/validation';
import { authLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/register', authLimiter, handleValidationErrors, (req, res, next) =>
  authController.register(req, res, next)
);

router.post('/login', authLimiter, handleValidationErrors, (req, res, next) =>
  authController.login(req, res, next)
);

router.get('/me', authMiddleware, timestampValidationMiddleware, (req, res, next) =>
  authController.getUserInfo(req, res, next)
);

router.post('/change-password', authMiddleware, timestampValidationMiddleware, (req, res, next) =>
  authController.updatePassword(req, res, next)
);

export default router;
