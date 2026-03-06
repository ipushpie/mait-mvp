/**
 * Lightweight structured logger with timestamps and timing helpers.
 * All output goes to stdout/stderr so Docker captures it with `docker compose logs`.
 */

function timestamp(): string {
  return new Date().toISOString();
}

export const logger = {
  info: (tag: string, msg: string, meta?: Record<string, unknown>) => {
    const extra = meta ? ' ' + JSON.stringify(meta) : '';
    console.log(`[${timestamp()}] [INFO] [${tag}] ${msg}${extra}`);
  },
  warn: (tag: string, msg: string, meta?: Record<string, unknown>) => {
    const extra = meta ? ' ' + JSON.stringify(meta) : '';
    console.warn(`[${timestamp()}] [WARN] [${tag}] ${msg}${extra}`);
  },
  error: (tag: string, msg: string, err?: unknown, meta?: Record<string, unknown>) => {
    const extra = meta ? ' ' + JSON.stringify(meta) : '';
    console.error(`[${timestamp()}] [ERROR] [${tag}] ${msg}${extra}`);
    if (err instanceof Error) {
      console.error(`[${timestamp()}] [ERROR] [${tag}] ${err.stack || err.message}`);
    } else if (err !== undefined) {
      console.error(`[${timestamp()}] [ERROR] [${tag}]`, err);
    }
  },
  debug: (tag: string, msg: string, meta?: Record<string, unknown>) => {
    if (process.env.DEBUG) {
      const extra = meta ? ' ' + JSON.stringify(meta) : '';
      console.log(`[${timestamp()}] [DEBUG] [${tag}] ${msg}${extra}`);
    }
  },
};

/** Returns elapsed seconds since `start` */
export function elapsed(start: number): string {
  return `${((Date.now() - start) / 1000).toFixed(1)}s`;
}
