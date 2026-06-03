import { Session } from '../models/Session.js';
import { ApiError } from '../utils/ApiError.js';
import { generateAssistance } from './gemini.service.js';

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

/** Mark a session complete and return its full summary. */
export async function completeSession(userId, sessionId) {
  const session = await getOwnedSession(userId, sessionId);
  if (session.status !== 'completed') {
    session.status = 'completed';
    session.completedAt = new Date();
    await session.save();
  }
  return session.toJSON();
}
