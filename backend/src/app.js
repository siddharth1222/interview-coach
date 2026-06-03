import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';

import { env } from './config/env.js';
import { ApiError } from './utils/ApiError.js';
import { globalLimiter } from './middleware/rateLimiter.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import apiRoutes from './routes/index.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1); // correct client IPs behind a proxy (rate limiting)

  app.use(helmet());
  app.use(
    cors({
      origin(origin, cb) {
        // Allow same-origin / tools (no origin) and explicitly listed origins.
        if (!origin || env.clientOrigins.includes(origin)) return cb(null, true);
        return cb(new ApiError(403, `Origin not allowed: ${origin}`));
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  if (!env.isProd) app.use(morgan('dev'));
  app.use(globalLimiter);

  app.use('/api', apiRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
