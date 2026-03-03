import app from "./app";
import { connectDB } from "./config/db";
import { assertRequiredEnv, env } from "./config/env";
import { startHistoryRetentionWorker } from "./services/history-retention.service";
import { seedDemoData } from "./seed/demo.seed";
import { logger } from "./utils/logger";

const PORT = env.port;

const startServer = async () => {
  assertRequiredEnv();
  await connectDB();
  if (process.env.ENABLE_DEMO_SEED === "true") {
    await seedDemoData();
  }
  startHistoryRetentionWorker();
  app.listen(PORT, () => {
    logger.info("server_listening", { port: PORT });
  });
};

startServer().catch((err) => {
  logger.error("server_start_failed", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
