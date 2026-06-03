import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);

/**
 * Establish the MongoDB connection. Retries are left to the orchestrator
 * (e.g. process manager) — we fail loudly so the platform can restart us.
 */
export async function connectDB() {
  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('error', (err) => logger.error('MongoDB error', err));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

  await mongoose.connect(env.MONGO_URI, {
    serverSelectionTimeoutMS: 10_000,
    autoIndex: !env.isProd, // build indexes automatically in dev only
  });

  return mongoose.connection;
}

export async function disconnectDB() {
  await mongoose.connection.close();
}
