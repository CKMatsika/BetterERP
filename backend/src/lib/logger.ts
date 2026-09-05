const isDev = process.env.NODE_ENV !== "production";

function timestamp(): string {
  return new Date().toISOString();
}

export const logger = {
  info: (...args: unknown[]) => {
    if (isDev) console.log(`[INFO] ${timestamp()}`, ...args);
  },
  warn: (...args: unknown[]) => console.warn(`[WARN] ${timestamp()}`, ...args),
  error: (...args: unknown[]) => console.error(`[ERROR] ${timestamp()}`, ...args),
  debug: (...args: unknown[]) => {
    if (isDev) console.log(`[DEBUG] ${timestamp()}`, ...args);
  },
};

export function logRequest(req: { method: string; url: string; ip?: string }, status: number, ms: number) {
  if (isDev) {
    console.log(`[HTTP] ${timestamp()} ${req.method} ${req.url} ${status} ${ms}ms ${req.ip ?? ""}`);
  }
}