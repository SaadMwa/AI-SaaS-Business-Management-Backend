import { Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import { entityService, EntityType } from "../services/entity.service";
import { logger } from "../utils/logger";

const parseEntityNumber = (value?: string) => {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const normalizeEntityType = (value?: string) => {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === "task" || normalized === "customer" || normalized === "sale") {
    return normalized as EntityType;
  }
  return null;
};

export const updateEntityByNumber = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const entityType = normalizeEntityType(req.params.entityType);
    if (!entityType) {
      return res.status(400).json({ success: false, message: "Invalid entity type" });
    }

    const entityNumber = parseEntityNumber(req.params.entityNumber);
    if (!entityNumber) {
      return res.status(400).json({ success: false, message: "Invalid entity number" });
    }

    const updated = await entityService.updateEntity(
      userId,
      entityType,
      entityNumber,
      { ...(req.body || {}), _performedBy: "user" }
    );

    return res.json({ success: true, entityType, entity: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update entity";
    if (message === "Customer not found" || message === "Sale not found" || message === "Task not found") {
      return res.status(404).json({ success: false, message });
    }
    if (message === "Assignee not found" || message === "Related entity not found") {
      return res.status(400).json({ success: false, message });
    }
    logger.error("entity_update_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to update entity" });
  }
};
