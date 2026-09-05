import "dotenv/config";
import { createApp } from "./app";
import { env } from "./config";
import { logger } from "./lib/logger";

const app = createApp();

app.listen(env.port, () => {
  logger.info(`BetterERP backend listening on http://localhost:${env.port}`);
  logger.info(`Environment: ${env.nodeEnv}`);
});