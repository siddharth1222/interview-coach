import { asyncHandler } from '../utils/asyncHandler.js';
import { logger } from '../utils/logger.js';
import { ApiError } from '../utils/ApiError.js';
import { streamQuestions } from '../services/gemini.service.js';
import * as sessionService from '../services/session.service.js';

/** Helper to write a Server-Sent Event frame. */
function sse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * POST /api/sessions
 * Streams question generation over SSE, then persists the session and emits a
 * terminal `done` event carrying the saved session document.
 */
export const createSession = asyncHandler(async (req, res) => {
  const { topic, difficulty } = req.body;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  sse(res, 'start', { topic, difficulty });

  // If the client disconnects mid-generation, stop caring about the result.
  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  try {
    const questions = await streamQuestions({
      topic,
      difficulty,
      onChunk: (text) => {
        if (!aborted) sse(res, 'chunk', { text });
      },
    });

    if (aborted) return res.end();

    const session = await sessionService.createSession({
      userId: req.userId,
      topic,
      difficulty,
      questions,
    });

    sse(res, 'done', { session });
    res.end();
  } catch (err) {
    logger.error('createSession stream failed', { message: err?.message });
    if (!aborted) {
      sse(res, 'error', { message: err?.message ?? 'Failed to generate session' });
    }
    res.end();
  }
});

export const getSession = asyncHandler(async (req, res) => {
  const session = await sessionService.getSession(req.userId, req.params.sessionId);
  res.json({ success: true, session });
});

export const listSessions = asyncHandler(async (req, res) => {
  const sessions = await sessionService.listSessions(req.userId);
  res.json({ success: true, sessions });
});

export const submitAnswer = asyncHandler(async (req, res) => {
  const { sessionId, order } = req.params;
  const session = await sessionService.submitAnswer(req.userId, sessionId, order, req.body.answer);
  res.json({ success: true, session });
});

export const requestAssistance = asyncHandler(async (req, res) => {
  const { sessionId, order } = req.params;
  const result = await sessionService.requestAssistance(req.userId, sessionId, order);
  res.json({ success: true, ...result });
});

export const completeSession = asyncHandler(async (req, res) => {
  const session = await sessionService.completeSession(req.userId, req.params.sessionId);
  res.json({ success: true, session });
});
