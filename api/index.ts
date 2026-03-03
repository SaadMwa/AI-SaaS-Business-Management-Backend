import app from "../src/app";
import { connectDB } from "../src/config/db";
import { assertRequiredEnv } from "../src/config/env";
import { logger } from "../src/utils/logger";

const appHandler = app as unknown as (req: any, res: any) => void;

export default async function handler(req: any, res: any) {
  try {
    assertRequiredEnv();
    await connectDB();
  } catch (error) {
    logger.error("backend_unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(503).json({ success: false, message: "Backend unavailable" });
  }

  return appHandler(req, res);
}