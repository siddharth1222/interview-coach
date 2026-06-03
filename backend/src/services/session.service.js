import { Session } from '../models/Session.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { generateAssistance, generateEvaluation } from './gemini.service.js';

/**
 * Persist a fully generated session (questions already produced by Gemini).
 * @param {{ userId: string, topic: string, difficulty: string, questions: string[] }} args
 */
export async function createSession({ userId, topic, difficulty, questions }) {
  const session = await Session.create({
    user: userId,
    topic,
    difficulty,
    questions: questions.map((prompt, order) => ({ order, prompt })),
  });
  return session.toJSON();
}

/** Fetch a session owned by the user or throw 404. */
async function getOwnedSession(userId, sessionId) {
  const session = await Session.findOne({ _id: sessionId, user: userId });
  if (!session) throw ApiError.notFound('Session not found');
  return session;
}

export async function getSession(userId, sessionId) {
  const session = await getOwnedSession(userId, sessionId);
  return session.toJSON();
}

export async function listSessions(userId) {
  const sessions = await Session.find({ user: userId })
    .sort({ createdAt: -1 })
    .select('topic difficulty status questions createdAt completedAt')
    .lean({ virtuals: true });

  // Trim heavy fields for list view.
  return sessions.map((s) => ({
    id: String(s._id),
    topic: s.topic,
    difficulty: s.difficulty,
    status: s.status,
    totalQuestions: s.questions.length,
    answeredCount: s.questions.filter((q) => q.answeredAt).length,
    assistanceUsedCount: s.questions.filter((q) => q.assistance?.used).length,
    createdAt: s.createdAt,
    completedAt: s.completedAt,
  }));
}

function questionAt(session, order) {
  const q = session.questions.find((item) => item.order === order);
  if (!q) throw ApiError.notFound('Question not found in this session');
  return q;
}

/** Save (or update) the user's answer to a question. */
export async function submitAnswer(userId, sessionId, order, answer) {
  const session = await getOwnedSession(userId, sessionId);
  if (session.status === 'completed') {
    throw ApiError.badRequest('This session is already completed');
  }
  const q = questionAt(session, order);
  q.userAnswer = answer;
  q.answeredAt = new Date();
  await session.save();
  return session.toJSON();
}

/**
 * Grant AI assistance for a question — enforced to once per question.
 * The hint is generated, persisted, and returned.
 */
export async function requestAssistance(userId, sessionId, order) {
  const session = await getOwnedSession(userId, sessionId);
  const q = questionAt(session, order);

  if (q.assistance?.used) {
    throw ApiError.forbidden('AI assistance has already been used for this question');
  }

  const content = await generateAssistance({
    topic: session.topic,
    difficulty: session.difficulty,
    question: q.prompt,
    userAnswer: q.userAnswer,
  });

  q.assistance = { used: true, content, usedAt: new Date() };
  await session.save();

  return { content, order };
}

/**
 * Mark a session complete. If evaluation hasn't started yet, flip it to
 * `in_progress` and signal the caller to kick off background scoring.
 * @returns {Promise<{ session: object, startEvaluation: boolean }>}
 */
export async function completeSession(userId, sessionId) {
  const session = await getOwnedSession(userId, sessionId);

  if (session.status !== 'completed') {
    session.status = 'completed';
    session.completedAt = new Date();
  }

  let startEvaluation = false;
  if (!session.evaluation || session.evaluation.status === 'not_started' || session.evaluation.status === 'failed') {
    session.evaluation.status = 'in_progress';
    session.evaluation.startedAt = new Date();
    startEvaluation = true;
  }

  await session.save();
  return { session: session.toJSON(), startEvaluation };
}

/**
 * Background job: score every question with Gemini and persist the totals.
 * Answered questions are graded by the AI (in parallel); empty answers are
 * scored 0 without an AI call. Reloads the session fresh to avoid stale state.
 */
export async function runEvaluation(userId, sessionId) {
  const session = await getOwnedSession(userId, sessionId);
  if (session.evaluation.status === 'completed') return; // idempotent

  try {
    const results = await Promise.all(
      session.questions.map(async (q) => {
        const answer = (q.userAnswer ?? '').trim();
        // Skip the AI call for unanswered/empty questions — faster + cheaper.
        if (!answer) {
          return { order: q.order, score: 0, feedback: 'No answer was submitted for this question.' };
        }
        const { score, feedback } = await generateEvaluation({
          topic: session.topic,
          difficulty: session.difficulty,
          question: q.prompt,
          answer,
        });
        return { order: q.order, score, feedback };
      })
    );

    let total = 0;
    for (const r of results) {
      const q = session.questions.find((item) => item.order === r.order);
      if (q) q.evaluation = { scored: true, score: r.score, feedback: r.feedback };
      total += r.score;
    }

    session.evaluation.status = 'completed';
    session.evaluation.totalScore = total;
    session.evaluation.completedAt = new Date();
    await session.save();
    logger.info('Session evaluation completed', { sessionId, total });
  } catch (err) {
    logger.error('Session evaluation failed', { sessionId, message: err?.message });
    session.evaluation.status = 'failed';
    session.evaluation.error = err?.message ?? 'Evaluation failed';
    await session.save().catch(() => {});
    throw err;
  }
}
