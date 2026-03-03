import { Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import { historyService } from "../services/history.service";
import { logger } from "../utils/logger";

export const getHistory = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { entityType, action, actionType, performedBy, from, to, entityId, olderThanDays, search } = req.query;
    const history = await historyService.getHistory(userId, {
      entityType: typeof entityType === "string" ? (entityType as any) : undefined,
      actionType:
        typeof actionType === "string"
          ? actionType
          : typeof action === "string"
          ? action
          : undefined,
      performedBy: typeof performedBy === "string" ? (performedBy as any) : undefined,
      from: typeof from === "string" ? from : undefined,
      to: typeof to === "string" ? to : undefined,
      entityId: typeof entityId === "string" ? Number(entityId) : undefined,
      olderThanDays: typeof olderThanDays === "string" ? Number(olderThanDays) : undefined,
      search: typeof search === "string" ? search : undefined,
    });

    return res.json({ success: true, history });
  } catch (error) {
    logger.error("history_get_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to fetch history" });
  }
};

export const getHistoryCount = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const days = typeof req.query.days === "string" ? Number(req.query.days) : undefined;
    const count = await historyService.getHistoryCount(userId, {
      olderThanDays: undefined,
      from:
        typeof days === "number" && Number.isFinite(days) && days > 0
          ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
          : undefined,
    });
    return res.json({ success: true, count });
  } catch (error) {
    logger.error("history_count_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to fetch history count" });
  }
};

export const deleteHistory = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const {
      entityType,
      entityId,
      actionType,
      performedBy,
      from,
      to,
      olderThanDays,
    } = req.body || {};

    const result = await historyService.deleteHistory(userId, {
      entityType: typeof entityType === "string" ? (entityType as any) : undefined,
      entityId: typeof entityId === "number" ? entityId : undefined,
      actionType: typeof actionType === "string" ? actionType : undefined,
      performedBy: typeof performedBy === "string" ? (performedBy as any) : undefined,
      from: typeof from === "string" ? from : undefined,
      to: typeof to === "string" ? to : undefined,
      olderThanDays: typeof olderThanDays === "number" ? olderThanDays : undefined,
    });

    return res.json({ success: true, deleted: result.deletedCount });
  } catch (error) {
    logger.error("history_delete_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to delete history" });
  }
};

export const deleteHistoryEntry = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const entryId = String(req.params.id || "").trim();
    if (!entryId) {
      return res.status(400).json({ success: false, message: "Invalid history id" });
    }

    const result = await historyService.deleteHistoryEntry(userId, entryId);
    if (!result.deletedCount) {
      return res.status(404).json({ success: false, message: "History entry not found" });
    }

    return res.json({ success: true, deleted: result.deletedCount });
  } catch (error) {
    logger.error("history_delete_entry_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to delete history entry" });
  }
};

export const exportHistory = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const format = req.query.format === "csv" ? "csv" : "json";
    const { entityType, action, actionType, performedBy, from, to, entityId, olderThanDays, search } = req.query;
    const content = await historyService.exportHistory(
      userId,
      {
        entityType: typeof entityType === "string" ? (entityType as any) : undefined,
        actionType:
          typeof actionType === "string"
            ? actionType
            : typeof action === "string"
            ? action
            : undefined,
        performedBy: typeof performedBy === "string" ? (performedBy as any) : undefined,
        from: typeof from === "string" ? from : undefined,
        to: typeof to === "string" ? to : undefined,
        entityId: typeof entityId === "string" ? Number(entityId) : undefined,
        olderThanDays: typeof olderThanDays === "string" ? Number(olderThanDays) : undefined,
        search: typeof search === "string" ? search : undefined,
      },
      format
    );

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `history-export-${ts}.${format}`;
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
    } else {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
    }
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(content);
  } catch (error) {
    logger.error("history_export_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to export history" });
  }
};

export const getHistorySettings = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const settings = await historyService.getRetentionSettings(userId);
    return res.json({ success: true, settings });
  } catch (error) {
    logger.error("history_settings_get_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to fetch settings" });
  }
};

export const updateHistorySettings = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { retentionDays } = req.body || {};
    if (retentionDays !== null && typeof retentionDays !== "number") {
      return res.status(400).json({ success: false, message: "Invalid retentionDays" });
    }
    const settings = await historyService.updateRetentionSettings(userId, retentionDays ?? null);
    return res.json({ success: true, settings });
  } catch (error) {
    logger.error("history_settings_update_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to update settings" });
  }
};
