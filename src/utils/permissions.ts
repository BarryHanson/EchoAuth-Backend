/**
 * Permission-based access control utilities
 */

export enum Role {
  GOD = 'god',
  OWNER = 'owner',
  SELLER = 'seller',
  USER = 'user',
}

export interface UserContext {
  userId: number;
  username: string;
  role: Role;
  ownerId?: number; // For sellers and users, which owner they belong to
}

/**
 * Check if user has permission to access a resource
 */
export class PermissionChecker {
  /**
   * Check if user can access admin features
   * Only God and Owner can access admin features
   */
  static canAccessAdmin(user: UserContext): boolean {
    return user.role === Role.GOD || user.role === Role.OWNER;
  }

  /**
   * Check if user can manage keys for an owner
   * God can manage all keys
   * Owner can only manage their own keys
   * Seller can generate keys for their assigned owner
   */
  static canManageKeysForOwner(user: UserContext, targetOwnerId: number): boolean {
    if (user.role === Role.GOD) return true;
    if (user.role === Role.OWNER && user.ownerId === targetOwnerId) return true;
    if (user.role === Role.SELLER && user.ownerId === targetOwnerId) return true;
    return false;
  }

  /**
   * Check if user can generate keys
   * God can generate for any owner
   * Owner can generate for their own program
   * Seller can generate for their assigned owner (within quota)
   */
  static canGenerateKeys(user: UserContext, targetOwnerId: number): boolean {
    if (user.role === Role.GOD) return true;
    if (user.role === Role.OWNER && user.ownerId === targetOwnerId) return true;
    if (user.role === Role.SELLER && user.ownerId === targetOwnerId) return true;
    return false;
  }

  /**
   * Check if user can reset HWID
   * God can reset any HWID
   * Owner can reset HWIDs for their program
   * Seller can reset HWIDs for their assigned owner
   */
  static canResetHwid(user: UserContext, targetOwnerId: number): boolean {
    if (user.role === Role.GOD) return true;
    if (user.role === Role.OWNER && user.ownerId === targetOwnerId) return true;
    if (user.role === Role.SELLER && user.ownerId === targetOwnerId) return true;
    return false;
  }

  /**
   * Check if user can manage cheats for an owner
   * God can manage all cheats
   * Owner can manage their own cheats
   */
  static canManageCheatForOwner(user: UserContext, targetOwnerId: number): boolean {
    if (user.role === Role.GOD) return true;
    if (user.role === Role.OWNER && user.ownerId === targetOwnerId) return true;
    return false;
  }

  /**
   * Check if user can manage bans for an owner
   * God can manage all bans
   * Owner can manage bans for their program
   * Seller can manage bans for their assigned owner
   */
  static canManageBansForOwner(user: UserContext, targetOwnerId: number): boolean {
    if (user.role === Role.GOD) return true;
    if (user.role === Role.OWNER && user.ownerId === targetOwnerId) return true;
    if (user.role === Role.SELLER && user.ownerId === targetOwnerId) return true;
    return false;
  }

  /**
   * Check if user can view logs for an owner
   * God can view all logs
   * Owner can view their own logs
   * Seller can view logs for their assigned owner
   */
  static canViewLogsForOwner(user: UserContext, targetOwnerId: number): boolean {
    if (user.role === Role.GOD) return true;
    if (user.role === Role.OWNER && user.ownerId === targetOwnerId) return true;
    if (user.role === Role.SELLER && user.ownerId === targetOwnerId) return true;
    return false;
  }

  /**
   * Check if user can manage sellers
   * Only God and Owners can manage sellers
   */
  static canManageSellers(user: UserContext): boolean {
    return user.role === Role.GOD || user.role === Role.OWNER;
  }

  /**
   * Check if user can manage an owner
   * Only God can manage owners
   */
  static canManageOwners(user: UserContext): boolean {
    return user.role === Role.GOD;
  }

  /**
   * Check if user can view all users
   * Only God can view all users
   * Owner can view only their sellers
   */
  static canViewAllUsers(user: UserContext): boolean {
    return user.role === Role.GOD;
  }

  /**
   * Check if user can access statistics
   * God can access global stats
   * Owner/Seller can access stats for their owner
   */
  static canViewStatsForOwner(user: UserContext, targetOwnerId: number): boolean {
    if (user.role === Role.GOD) return true;
    if (user.role === Role.OWNER && user.ownerId === targetOwnerId) return true;
    if (user.role === Role.SELLER && user.ownerId === targetOwnerId) return true;
    return false;
  }
}
