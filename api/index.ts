import app from "../src/app";
import { connectDB } from "../src/config/db";
import { assertRequiredEnv } from "../src/config/env";
import { applyCorsHeaders } from "../src/config/cors";
import { logger } from "../src/utils/logger";

const appHandler = app as unknown as (req: any, res: any) => void;

// ✅ Global variable to cache connection (reused across requests)
let isConnected = false;

export default async function handler(req: any, res: any) {
  if (req.method === "OPTIONS") {
    return appHandler(req, res);
  }

  try {
    assertRequiredEnv();
    
    // ✅ ONLY connect if not already connected
    if (!isConnected) {
      logger.info("Connecting to database...");
      await connectDB();
      isConnected = true;
      logger.info("Database connected successfully");
    }
  } catch (error) {
    applyCorsHeaders(req, res);
    logger.error("backend_unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(503).json({ success: false, message: "Backend unavailable" });
  }

  return appHandler(req, res);
}