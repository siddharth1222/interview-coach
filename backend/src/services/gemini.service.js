import { GoogleGenAI, Type } from '@google/genai';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { TOPICS, DIFFICULTIES, QUESTIONS_PER_SESSION } from '../config/constants.js';

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

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
    throw ApiError.internal('Failed to generate questions from the AI service');
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
    throw ApiError.internal('Failed to get AI assistance');
  }
}
