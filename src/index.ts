import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import { CheatFileService } from './services/CheatFileService';
import { signResponse } from './middleware/responseSignature';
import { apiLimiter, authLimiter, keyGenerationLimiter, downloadLimiter } from './middleware/rateLimiter';
import authRoutes from './routes/authRoutes';
import clientRoutes from './routes/clientRoutes';
import adminRoutes from './routes/adminRoutes';
import ownerRoutes from './routes/ownerRoutes';
import registrationRoutes from './routes/registrationRoutes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  })
);

// Security middleware
app.use(signResponse); // Sign all responses with HMAC
app.use(apiLimiter); // General rate limiting

app.use((_req, _res, next) => {
  logger.debug(`${_req.method} ${_req.path}`);
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/client', clientRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/owners', ownerRoutes);
app.use('/api/registration', registrationRoutes);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
  });
});

app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Endpoint not found',
    timestamp: Date.now(),
  });
});

app.use(errorHandler);

// Initialize storage directories
CheatFileService.initializeStorage();

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;
