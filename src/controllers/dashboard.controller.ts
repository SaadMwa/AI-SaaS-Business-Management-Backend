import { Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import { Sale } from "../models/sale";
import { Task } from "../models/task";
import { generateInsights, getDashboardMetrics } from "../services/analytics.service";
import { logger } from "../utils/logger";

export const getDashboard = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const [metrics, recentSales, pendingTasks, insights] = await Promise.all([
      getDashboardMetrics(userId),
      Sale.find({ createdBy: userId })
        .sort({ date: -1 })
        .limit(5)
        .populate("customerId", "name email"),
      Task.find({ createdBy: userId, status: { $ne: "done" } })
        .sort({ dueDate: 1 })
        .limit(5),
      generateInsights(userId),
    ]);

    return res.json({
      success: true,
      metrics,
      recentSales,
      pendingTasks,
      pendingTaskOverview: metrics.pendingTasksByPriority,
      lowStockWarnings: metrics.lowStockProducts || [],
      insights,
    });
  } catch (error) {
    logger.error("dashboard_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to load dashboard" });
  }
};
