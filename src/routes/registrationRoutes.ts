import { Router } from 'express';
import { registrationController } from '../controllers/RegistrationController';
import { userSubscriptionController } from '../controllers/UserSubscriptionController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

/**
 * Public endpoints (no auth required)
 */

// Get registration token info (for signup forms)
router.get('/token-info', (req, res, next) =>
  registrationController.getTokenInfo(req, res, next)
);

// Get program info by slug (for user registration)
router.get('/program', (req, res, next) =>
  registrationController.getProgramBySlug(req, res, next)
);

// Link key to user account after registration (public - uses token auth)
router.post('/link-key', (req, res, next) =>
  registrationController.linkKey(req, res, next)
);

// Link key to user directly without token
router.post('/link-key-direct', (req, res, next) =>
  registrationController.linkKeyDirect(req, res, next)
);

// Link seller token after registration
router.post('/link-seller-token', (req, res, next) =>
  registrationController.linkSellerToken(req, res, next)
);

/**
 * Protected endpoints (auth required)
 */

router.use(authMiddleware);

// Registration token management (Owner/God only)
router.post('/tokens/user', (req, res, next) =>
  registrationController.generateUserToken(req, res, next)
);

router.post('/tokens/seller', (req, res, next) =>
  registrationController.generateSellerToken(req, res, next)
);

router.get('/tokens/:ownerId', (req, res, next) =>
  registrationController.getOwnerTokens(req, res, next)
);

router.delete('/tokens', (req, res, next) =>
  registrationController.deleteToken(req, res, next)
);

// User subscription endpoints
router.get('/my-subscription', (req, res, next) =>
  userSubscriptionController.getMySubscription(req, res, next)
);

router.post('/activate', (req, res, next) =>
  userSubscriptionController.activateSubscription(req, res, next)
);

router.post('/reset-hwid', (req, res, next) =>
  userSubscriptionController.resetHwid(req, res, next)
);

router.post('/reset-ip', (req, res, next) =>
  userSubscriptionController.resetIp(req, res, next)
);

router.post('/replace-key', (req, res, next) =>
  userSubscriptionController.replaceKey(req, res, next)
);

router.get('/users/:ownerId', (req, res, next) =>
  userSubscriptionController.getProgramUsers(req, res, next)
);

router.post('/users/revoke', (req, res, next) =>
  userSubscriptionController.revokeUserSubscription(req, res, next)
);

export default router;
