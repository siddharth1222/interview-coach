import { Router } from 'express';
import * as sessionController from '../controllers/session.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { aiLimiter } from '../middleware/rateLimiter.js';
import {
  createSessionSchema,
  sessionIdSchema,
  questionParamsSchema,
  submitAnswerSchema,
} from '../validators/session.validator.js';

const router = Router();

// All session routes require an authenticated user.
router.use(requireAuth);

router.get('/', sessionController.listSessions);
router.post('/', aiLimiter, validate(createSessionSchema), sessionController.createSession);

router.get('/:sessionId', validate(sessionIdSchema), sessionController.getSession);
router.post('/:sessionId/complete', validate(sessionIdSchema), sessionController.completeSession);

router.post(
  '/:sessionId/questions/:order/answer',
  validate(submitAnswerSchema),
  sessionController.submitAnswer
);

router.post(
  '/:sessionId/questions/:order/assist',
  aiLimiter,
  validate(questionParamsSchema),
  sessionController.requestAssistance
);

export default router;
