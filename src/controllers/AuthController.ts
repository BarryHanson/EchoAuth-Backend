import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/AuthService';
import { ApiResponse } from '../types';
import { logger } from '../utils/logger';

export class AuthController {
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const { username, password, role } = req.body;

      if (!username || !password) {
        res.status(400).json({
          status: 'error',
          message: 'Username and password are required',
          timestamp: Date.now(),
        });
        return;
      }

      const user = await authService.registerUser(
        username,
        password,
        role || 'owner'
      );

      const response: ApiResponse<typeof user> = {
        status: 'success',
        data: user,
        timestamp: Date.now(),
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { username, password, hwid } = req.body;

      if (!username || !password) {
        res.status(400).json({
          status: 'error',
          message: 'Username and password are required',
          timestamp: Date.now(),
        });
        return;
      }

      // Get client IP
      let ip = req.ip || '0.0.0.0';
      if (ip === '::1' || ip === '::ffff:127.0.0.1') {
        ip = '127.0.0.1';
      } else if (ip.startsWith('::ffff:')) {
        ip = ip.substring(7);
      }

      const result = await authService.loginUser(username, password, hwid, ip);

      res.json({
        status: 'success',
        data: {
          token: result.token,
          user: result.user,
        },
        timestamp: Date.now(),
      });
    } catch (error) {
      next(error);
    }
  }

  async getUserInfo(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        res.status(401).json({
          status: 'error',
          message: 'Unauthorized',
          timestamp: Date.now(),
        });
        return;
      }

      const user = await authService.getUserInfo(req.user.userId);

      const response: ApiResponse<typeof user> = {
        status: 'success',
        data: user,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async updatePassword(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        res.status(401).json({
          status: 'error',
          message: 'Unauthorized',
          timestamp: Date.now(),
        });
        return;
      }

      const { oldPassword, newPassword } = req.body;

      if (!oldPassword || !newPassword) {
        res.status(400).json({
          status: 'error',
          message: 'Old password and new password are required',
          timestamp: Date.now(),
        });
        return;
      }

      await authService.updatePassword(req.user.userId, oldPassword, newPassword);

      const response: ApiResponse<null> = {
        status: 'success',
        message: 'Password updated successfully',
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
