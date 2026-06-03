/* Tiny structured logger. Swap for pino/winston in production if needed. */
const ts = () => new Date().toISOString();

export const logger = {
  info: (msg, meta) => console.log(`[${ts()}] INFO  ${msg}`, meta ?? ''),
  warn: (msg, meta) => console.warn(`[${ts()}] WARN  ${msg}`, meta ?? ''),
  error: (msg, meta) => console.error(`[${ts()}] ERROR ${msg}`, meta ?? ''),
  debug: (msg, meta) => {
    if (process.env.NODE_ENV !== 'production') console.debug(`[${ts()}] DEBUG ${msg}`, meta ?? '');
  },
};
