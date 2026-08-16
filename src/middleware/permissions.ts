import { Request, Response, NextFunction } from 'express';
import { ApiError } from './errorHandler';
import { PermissionChecker, Role, UserContext } from '../utils/permissions';

/**
 * Extend Express Request to include user context
 */
declare global {
  namespace Express {
    interface Request {
      userContext?: UserContext;
    }
  }
}

/**
 * Middleware to require admin access (God or Owner role)
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.userContext) {
    throw new ApiError(401, 'Unauthorized');
  }

  if (!PermissionChecker.canAccessAdmin(req.userContext)) {
    throw new ApiError(403, 'Forbidden: Admin access required');
  }

  next();
};

/**
 * Middleware to require key management permission for a specific owner
 * Query/body param: ownerId
 */
export const requireKeyManagementPermission = (req: Request, res: Response, next: NextFunction) => {
  if (!req.userContext) {
    throw new ApiError(401, 'Unauthorized');
  }

  const targetOwnerId = parseInt(req.query.ownerId as string || req.body.ownerId);

  if (!targetOwnerId) {
    throw new ApiError(400, 'ownerId is required');
  }

  if (!PermissionChecker.canManageKeysForOwner(req.userContext, targetOwnerId)) {
    throw new ApiError(403, 'Forbidden: Cannot manage keys for this owner');
  }

  next();
};

/**
 * Middleware to require cheat management permission for a specific owner
 */
export const requireCheatManagementPermission = (req: Request, res: Response, next: NextFunction) => {
  if (!req.userContext) {
    throw new ApiError(401, 'Unauthorized');
  }

  const targetOwnerId = parseInt(req.query.ownerId as string || req.body.ownerId);

  if (!targetOwnerId) {
    throw new ApiError(400, 'ownerId is required');
  }

  if (!PermissionChecker.canManageCheatForOwner(req.userContext, targetOwnerId)) {
    throw new ApiError(403, 'Forbidden: Cannot manage cheats for this owner');
  }

  next();
};

/**
 * Middleware to require ban management permission for a specific owner
 */
export const requireBanManagementPermission = (req: Request, res: Response, next: NextFunction) => {
  if (!req.userContext) {
    throw new ApiError(401, 'Unauthorized');
  }

  const targetOwnerId = parseInt(req.query.ownerId as string || req.body.ownerId);

  if (!targetOwnerId) {
    throw new ApiError(400, 'ownerId is required');
  }

  if (!PermissionChecker.canManageBansForOwner(req.userContext, targetOwnerId)) {
    throw new ApiError(403, 'Forbidden: Cannot manage bans for this owner');
  }

  next();
};

/**
 * Middleware to require log viewing permission for a specific owner
 */
export const requireLogViewPermission = (req: Request, res: Response, next: NextFunction) => {
  if (!req.userContext) {
    throw new ApiError(401, 'Unauthorized');
  }

  const targetOwnerId = parseInt(req.query.ownerId as string || req.body.ownerId);

  if (!targetOwnerId) {
    throw new ApiError(400, 'ownerId is required');
  }

  if (!PermissionChecker.canViewLogsForOwner(req.userContext, targetOwnerId)) {
    throw new ApiError(403, 'Forbidden: Cannot view logs for this owner');
  }

  next();
};

/**
 * Middleware to require God role
 * Only the website owner (God) can perform this action
 */
export const requireGodRole = (req: Request, res: Response, next: NextFunction) => {
  if (!req.userContext) {
    throw new ApiError(401, 'Unauthorized');
  }

  if (req.userContext.role !== Role.GOD) {
    throw new ApiError(403, 'Forbidden: God role required');
  }

  next();
};

/**
 * Middleware to require Owner role
 * Only owners and God can perform this action
 */
export const requireOwnerRole = (req: Request, res: Response, next: NextFunction) => {
  if (!req.userContext) {
    throw new ApiError(401, 'Unauthorized');
  }

  if (req.userContext.role !== Role.OWNER && req.userContext.role !== Role.GOD) {
    throw new ApiError(403, 'Forbidden: Owner role required');
  }

  next();
};

/**
 * Middleware to require Seller role or above
 */
export const requireSellerRole = (req: Request, res: Response, next: NextFunction) => {
  if (!req.userContext) {
    throw new ApiError(401, 'Unauthorized');
  }

  if (
    req.userContext.role !== Role.SELLER &&
    req.userContext.role !== Role.OWNER &&
    req.userContext.role !== Role.GOD
  ) {
    throw new ApiError(403, 'Forbidden: Seller role required');
  }

  next();
};
