import { Router } from "express";
import { authenticate, requireAdmin } from "../middlewares/auth.middleware";
import {
  createTask,
  deleteTask,
  deleteTaskByNumber,
  getTaskById,
  getTaskByNumber,
  getTasks,
  assignTaskByNumber,
  unassignTaskByNumber,
  updateTask,
  updateTaskByNumber,
  updateTaskStatus,
} from "../controllers/task.controller";

const router = Router();

router.get("/", authenticate, requireAdmin, getTasks);
router.post("/", authenticate, requireAdmin, createTask);
router.get("/number/:task_number", authenticate, requireAdmin, getTaskByNumber);
router.get("/:id", authenticate, requireAdmin, getTaskById);
router.put("/number/:task_number", authenticate, requireAdmin, updateTaskByNumber);
router.put("/:id", authenticate, requireAdmin, updateTask);
router.patch("/:id/status", authenticate, requireAdmin, updateTaskStatus);
router.post("/number/:task_number/assign", authenticate, requireAdmin, assignTaskByNumber);
router.post("/number/:task_number/unassign", authenticate, requireAdmin, unassignTaskByNumber);
router.delete("/number/:task_number", authenticate, requireAdmin, deleteTaskByNumber);
router.delete("/:id", authenticate, requireAdmin, deleteTask);

export default router;
