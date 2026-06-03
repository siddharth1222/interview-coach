import { z } from 'zod';
import { TOPIC_KEYS, DIFFICULTY_KEYS } from '../config/constants.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const createSessionSchema = {
  body: z.object({
    topic: z.enum(TOPIC_KEYS),
    difficulty: z.enum(DIFFICULTY_KEYS),
  }),
};

export const sessionIdSchema = {
  params: z.object({ sessionId: objectId }),
};

export const questionParamsSchema = {
  params: z.object({
    sessionId: objectId,
    order: z.coerce.number().int().min(0),
  }),
};

export const submitAnswerSchema = {
  params: z.object({
    sessionId: objectId,
    order: z.coerce.number().int().min(0),
  }),
  body: z.object({
    answer: z.string().max(10_000, 'Answer is too long').default(''),
  }),
};
