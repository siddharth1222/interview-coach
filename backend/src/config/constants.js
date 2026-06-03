/** Predefined, server-validated domain values. The client must match these. */
export const TOPICS = Object.freeze({
  'generative-ai': 'Generative AI',
  javascript: 'JavaScript',
  mongodb: 'MongoDB',
  python: 'Python',
  sql: 'SQL',
  reactjs: 'React.js',
  expressjs: 'Express.js'
});

export const DIFFICULTIES = Object.freeze({
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
});

export const TOPIC_KEYS = Object.keys(TOPICS);
export const DIFFICULTY_KEYS = Object.keys(DIFFICULTIES);

export const QUESTIONS_PER_SESSION = 5;
