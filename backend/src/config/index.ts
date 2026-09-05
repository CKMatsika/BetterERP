import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name];
  if (!value && fallback === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? (fallback as string);
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: parseInt(process.env.PORT ?? "4000", 10),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: required("JWT_EXPIRES_IN", "12h"),
  refreshTokenExpires: required("REFRESH_TOKEN_EXPIRES", "7d"),
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS ?? "12", 10),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "900000", 10),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX ?? "2000", 10),
  fileUploadDir: required("FILE_UPLOAD_DIR", "./uploads"),
  maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB ?? "10", 10),
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};