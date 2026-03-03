import { Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import { generateInsights } from "../services/analytics.service";
import { logger } from "../utils/logger";

export const getInsights = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const insights = await generateInsights(userId);
    return res.json({ success: true, insights, generatedAt: new Date().toISOString() });
  } catch (error) {
    logger.error("insights_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to generate insights" });
  }
};
