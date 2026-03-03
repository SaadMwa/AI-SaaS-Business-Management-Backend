import { historyService } from "./history.service";
import { logger } from "../utils/logger";

const DAY_MS = 24 * 60 * 60 * 1000;

export const startHistoryRetentionWorker = () => {
  const run = async () => {
    try {
      const results = await historyService.cleanupOldHistory();
      if (results.length) {
        const totalDeleted = results.reduce((sum, item) => sum + item.deletedCount, 0);
        if (totalDeleted > 0) {
          logger.info("history_retention_deleted", { totalDeleted });
        }
      }
    } catch (error) {
      logger.warn("history_retention_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  void run();
  const interval = setInterval(run, DAY_MS);
  return () => clearInterval(interval);
};
