import { GoogleGenAI, Type } from '@google/genai';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { TOPICS, DIFFICULTIES, QUESTIONS_PER_SESSION } from '../config/constants.js';

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

/**
 * Translate an error from the Gemini SDK into an ApiError with an honest,
 * user-facing message. Upstream availability/quota problems are NOT our fault,
 * so we surface them as 503/429 with a clear "try again" message instead of a
 * generic 500. Anything else falls back to a 500 with `fallback`.
 *
 * @param {unknown} err
 * @param {string} fallback - message used for genuinely unexpected failures
 * @returns {ApiError}
 */
function mapGeminiError(err, fallback) {
  // The SDK surfaces the HTTP status in different shapes; the upstream payload
  // is also embedded in the message, so we inspect both.
  const raw = `${err?.status ?? ''} ${err?.code ?? ''} ${err?.message ?? ''}`.toUpperCase();

  const isOverloaded =
    raw.includes('503') ||
    raw.includes('UNAVAILABLE') ||
    raw.includes('OVERLOADED') ||
    raw.includes('HIGH DEMAND');

  const isRateLimited =
    raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED') || raw.includes('QUOTA');

  if (isOverloaded) {
    return ApiError.serviceUnavailable(
      'The AI service is currently experiencing high demand. Please try again in a few moments.'
    );
  }
  if (isRateLimited) {
    return ApiError.tooMany(
      'The AI service rate limit was reached. Please wait a moment and try again.'
    );
  }
  return ApiError.internal(fallback);
}

/** Schema forcing the model to return exactly the questions array we expect. */
const QUESTIONS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      minItems: QUESTIONS_PER_SESSION,
      maxItems: QUESTIONS_PER_SESSION,
      items: { type: Type.STRING },
    },
  },
  required: ['questions'],
};

function questionGenPrompt(topicLabel, difficultyLabel) {
  return [
    `You are a senior technical interviewer.`,
    `Generate exactly ${QUESTIONS_PER_SESSION} distinct interview questions about "${topicLabel}"`,
    `for a candidate at the "${difficultyLabel}" level.`,
    `Rules:`,
    `- Questions must be clearly relevant to ${topicLabel} and calibrated to ${difficultyLabel} difficulty.`,
    `- Make them open-ended and conceptual (no multiple choice).`,
    `- Do NOT include answers, hints, or numbering — only the question text.`,
    `- Each question should be self-contained and 1-3 sentences long.`,
  ].join('\n');
}

/**
 * Streams interview-question generation from Gemini.
 * Raw text deltas are pushed via `onChunk` (for live UX); the fully parsed,
 * validated list of question strings is returned when the stream completes.
 *
 * @param {{ topic: string, difficulty: string, onChunk?: (text: string) => void }} args
 * @returns {Promise<string[]>}
 */
export async function streamQuestions({ topic, difficulty, onChunk }) {
  const topicLabel = TOPICS[topic];
  const difficultyLabel = DIFFICULTIES[difficulty];

  let raw = '';
  try {
    const stream = await ai.models.generateContentStream({
      model: env.GEMINI_MODEL,
      contents: questionGenPrompt(topicLabel, difficultyLabel),
      config: {
        temperature: 0.9,
        responseMimeType: 'application/json',
        responseSchema: QUESTIONS_SCHEMA,
      },
    });

    for await (const chunk of stream) {
      const text = chunk.text ?? '';
      if (!text) continue;
      raw += text;
      onChunk?.(text);
    }
  } catch (err) {
    logger.error('Gemini question generation failed', { message: err?.message });
    throw mapGeminiError(err, 'Failed to generate questions from the AI service');
  }

  const questions = parseQuestions(raw);
  if (questions.length !== QUESTIONS_PER_SESSION) {
    throw ApiError.internal('AI returned an unexpected number of questions');
  }
  return questions;
}

function parseQuestions(raw) {
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed.questions;
    return (list ?? [])
      .map((q) => String(q).trim())
      .filter(Boolean)
      .slice(0, QUESTIONS_PER_SESSION);
  } catch {
    logger.error('Could not parse Gemini questions JSON', { raw: raw.slice(0, 500) });
    throw ApiError.internal('AI returned an unparseable response');
  }
}

/**
 * Produces hints/guidance for a question WITHOUT giving away the answer.
 * @param {{ topic: string, difficulty: string, question: string, userAnswer?: string }} args
 * @returns {Promise<string>}
 */
export async function generateAssistance({ topic, difficulty, question, userAnswer }) {
  const topicLabel = TOPICS[topic];
  const difficultyLabel = DIFFICULTIES[difficulty];

  const prompt = [
    `You are a supportive interview coach helping a ${difficultyLabel}-level candidate`,
    `with a "${topicLabel}" interview question. Your job is to GUIDE, never to answer.`,
    ``,
    `QUESTION: ${question}`,
    userAnswer?.trim() ? `\nThe candidate's current draft answer: """${userAnswer.trim()}"""` : '',
    ``,
    `Respond in Markdown with these sections, and these ONLY:`,
    `### Hints`,
    `2-3 nudges that point toward the right thinking.`,
    `### Suggested Approach`,
    `How to structure or reason about an answer (steps/framework), not the answer itself.`,
    `### Related Concepts`,
    `Key terms/ideas worth reviewing.`,
    `### Learning Resources`,
    `1-3 general resources or documentation areas to study.`,
    ``,
    `STRICT RULES:`,
    `- Never state the final/correct answer, code solution, or definitive explanation.`,
    `- Never write code that solves it; pseudo-direction is fine.`,
    `- If the draft answer is on the wrong track, gently redirect without revealing the answer.`,
    `- Keep it concise and encouraging.`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const response = await ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: prompt,
      config: { temperature: 0.6 },
    });
    const text = response.text?.trim();
    if (!text) throw new Error('Empty assistance response');
    return text;
  } catch (err) {
    logger.error('Gemini assistance failed', { message: err?.message });
    throw mapGeminiError(err, 'Failed to get AI assistance');
  }
}

/** Schema forcing a numeric score (0-10) plus short feedback. */
const EVALUATION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    score: { type: Type.INTEGER, minimum: 0, maximum: 10 },
    feedback: { type: Type.STRING },
  },
  required: ['score', 'feedback'],
};

/**
 * Evaluates a single answer and returns a score out of 10 with brief feedback.
 * Callers must pass a non-empty, trimmed answer (empty answers are scored 0
 * without an AI call by the session service).
 *
 * @param {{ topic: string, difficulty: string, question: string, answer: string }} args
 * @returns {Promise<{ score: number, feedback: string }>}
 */
export async function generateEvaluation({ topic, difficulty, question, answer }) {
  const topicLabel = TOPICS[topic];
  const difficultyLabel = DIFFICULTIES[difficulty];

  const prompt = [
    `You are a strict but fair technical interviewer grading a ${difficultyLabel}-level`,
    `"${topicLabel}" interview answer.`,
    ``,
    `QUESTION: ${question}`,
    `CANDIDATE ANSWER: """${answer}"""`,
    ``,
    `Score the answer from 0 to 10 based on correctness, completeness, clarity, and depth`,
    `appropriate for the ${difficultyLabel} level. Provide 1-2 sentences of constructive`,
    `feedback explaining the score and how to improve. Be concise and objective.`,
  ].join('\n');

  try {
    const response = await ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: prompt,
      config: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: EVALUATION_SCHEMA,
      },
    });

    const parsed = JSON.parse(response.text ?? '{}');
    let score = Math.round(Number(parsed.score));
    if (!Number.isFinite(score)) score = 0;
    score = Math.max(0, Math.min(10, score));
    return { score, feedback: String(parsed.feedback ?? '').trim() };
  } catch (err) {
    logger.error('Gemini evaluation failed', { message: err?.message });
    throw mapGeminiError(err, 'Failed to evaluate answer');
  }
}
