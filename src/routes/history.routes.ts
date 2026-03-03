import { Router } from "express";
import { authenticate, requireAdmin } from "../middlewares/auth.middleware";
import {
  deleteHistory,
  deleteHistoryEntry,
  exportHistory,
  getHistory,
  getHistoryCount,
  getHistorySettings,
  updateHistorySettings,
} from "../controllers/history.controller";

const router = Router();

router.get("/", authenticate, requireAdmin, getHistory);
router.get("/count", authenticate, requireAdmin, getHistoryCount);
router.get("/export", authenticate, requireAdmin, exportHistory);
router.delete("/", authenticate, requireAdmin, deleteHistory);
router.delete("/:id", authenticate, requireAdmin, deleteHistoryEntry);
router.get("/settings", authenticate, requireAdmin, getHistorySettings);
router.put("/settings", authenticate, requireAdmin, updateHistorySettings);

export default router;
