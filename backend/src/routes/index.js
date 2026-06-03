import { Router } from 'express';
import authRoutes from './auth.routes.js';
import sessionRoutes from './session.routes.js';
import { TOPICS, DIFFICULTIES } from '../config/constants.js';

const router = Router();

router.get('/health', (_req, res) => res.json({ success: true, status: 'ok' }));

// Expose the predefined catalogue so the client never hardcodes domain values.
router.get('/catalog', (_req, res) => {
  res.json({
    success: true,
    topics: Object.entries(TOPICS).map(([value, label]) => ({ value, label })),
    difficulties: Object.entries(DIFFICULTIES).map(([value, label]) => ({ value, label })),
  });
});

router.use('/auth', authRoutes);
router.use('/sessions', sessionRoutes);

export default router;
