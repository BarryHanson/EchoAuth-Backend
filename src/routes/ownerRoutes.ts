import { Router } from 'express';
import { ownerController } from '../controllers/OwnerController';
import { authMiddleware } from '../middleware/auth';
import { requireGodRole, requireOwnerRole } from '../middleware/permissions';

const router = Router();

// All owner routes require authentication
router.use(authMiddleware);

/**
 * Owner management routes
 */

// Create owner/program (God or Owner)
// God can create new owner accounts with programs
// Owner can create additional programs under their account
router.post('/', (req, res, next) =>
  ownerController.createOwner(req, res, next)
);

// Get all owners (God gets all, Owner gets their own)
router.get('/', (req, res, next) =>
  ownerController.getAllOwners(req, res, next)
);

// Get current owner's program (Owner only)
router.get('/my', requireOwnerRole, (req, res, next) =>
  ownerController.getMyOwner(req, res, next)
);

// Get specific owner (God or Owner)
router.get('/:ownerId', (req, res, next) =>
  ownerController.getOwner(req, res, next)
);

// Update owner (God or Owner)
router.put('/:ownerId', (req, res, next) =>
  ownerController.updateOwner(req, res, next)
);

// Delete owner (God only)
router.delete('/:ownerId', requireGodRole, (req, res, next) =>
  ownerController.deleteOwner(req, res, next)
);

/**
 * Seller management routes
 */

// Create seller for owner (Owner or God)
router.post('/:ownerId/sellers', (req, res, next) =>
  ownerController.createSeller(req, res, next)
);

// Get all sellers for owner (Owner or God)
router.get('/:ownerId/sellers', (req, res, next) =>
  ownerController.getSellers(req, res, next)
);

// Update seller (Owner or God)
router.put('/:ownerId/sellers/:sellerId', (req, res, next) =>
  ownerController.updateSeller(req, res, next)
);

// Delete seller (Owner or God)
router.delete('/:ownerId/sellers/:sellerId', (req, res, next) =>
  ownerController.deleteSeller(req, res, next)
);

export default router;
