import { Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import { Task } from "../models/task";
import { Customer } from "../models/customer";
import { Sale } from "../models/sale";
import { taskService } from "../services/task.service";
import { logger } from "../utils/logger";

const getUserId = (req: AuthRequest) => req.user?.userId;

const validateRelatedEntity = async (
  userId: string,
  relatedToType?: string,
  relatedToId?: string
) => {
  if (!relatedToType || !relatedToId) return true;
  if (relatedToType === "customer") {
    const customer = await Customer.findOne({ _id: relatedToId, createdBy: userId });
    return Boolean(customer);
  }
  if (relatedToType === "sale") {
    const sale = await Sale.findOne({ _id: relatedToId, createdBy: userId });
    return Boolean(sale);
  }
  return false;
};

const validateRelatedInput = (relatedToType?: string, relatedToId?: string) => {
  if ((relatedToType && !relatedToId) || (!relatedToType && relatedToId)) {
    return false;
  }
  return true;
};

const autoTagFromText = (text: string) => {
  const lower = text.toLowerCase();
  const tags = new Set<string>();
  const rules: Array<[string, string]> = [
    ["follow up", "follow-up"],
    ["follow-up", "follow-up"],
    ["customer", "customer"],
    ["sale", "sale"],
    ["invoice", "invoice"],
    ["payment", "payment"],
    ["email", "email"],
    ["call", "call"],
    ["meeting", "meeting"],
    ["demo", "demo"],
    ["bug", "bug"],
    ["issue", "issue"],
    ["urgent", "urgent"],
    ["onboarding", "onboarding"],
    ["renewal", "renewal"],
  ];
  rules.forEach(([needle, tag]) => {
    if (lower.includes(needle)) tags.add(tag);
  });
  return Array.from(tags);
};

const buildTags = (title?: string, description?: string) => {
  const text = [title, description].filter(Boolean).join(" ");
  return text ? autoTagFromText(text) : [];
};

const normalizeStatus = (value?: string) => {
  if (!value) return value;
  return value === "in-progress" ? "in_progress" : value;
};

const parseTaskNumber = (value: string | undefined) => {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const handleTaskError = (res: Response, error: unknown, message: string) => {
  const detail = error instanceof Error ? error.message : "";
  if (detail === "Task not found") {
    return res.status(404).json({ success: false, message: "Task not found" });
  }
  if (detail === "Assignee not found" || detail === "Related entity not found") {
    return res.status(400).json({ success: false, message: detail });
  }
  logger.error("task_error", {
    message,
    error: error instanceof Error ? error.message : String(error),
  });
  return res.status(500).json({ success: false, message: "Failed to process task request" });
};

export const createTask = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const {
      title,
      description,
      dueDate,
      status,
      priority,
      assignedTo,
      relatedToType,
      relatedToId,
      tags,
      raw_input,
      parsed_input,
    } = req.body;

    const rawInput = raw_input || title;
    const resolvedTitle = title || rawInput;

    if (!resolvedTitle) {
      return res.status(400).json({ success: false, message: "Task title is required" });
    }

    if (!validateRelatedInput(relatedToType, relatedToId)) {
      return res
        .status(400)
        .json({ success: false, message: "Both relatedToType and relatedToId are required" });
    }

    const relatedOk = await validateRelatedEntity(userId, relatedToType, relatedToId);
    if (!relatedOk) {
      return res.status(400).json({ success: false, message: "Related entity not found" });
    }

    const task = await taskService.createTask(userId, {
      title: resolvedTitle,
      raw_input: rawInput,
      parsed_input,
      description,
      dueDate,
      status: normalizeStatus(status),
      priority: priority || "medium",
      assignedTo,
      relatedToType,
      relatedToId,
      tags: Array.isArray(tags) && tags.length ? tags : buildTags(resolvedTitle, description),
    });
    return res.status(201).json({ success: true, task });
  } catch (error) {
    logger.error("task_create_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to create task" });
  }
};

export const getTasks = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { status, priority } = req.query;
    const filters: Record<string, unknown> = {};

    if (status && typeof status === "string") filters.status = status;
    if (priority && typeof priority === "string") filters.priority = priority;

    const tasks = await taskService.listTasks(userId, filters);
    return res.json({ success: true, tasks });
  } catch (error) {
    logger.error("task_list_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to fetch tasks" });
  }
};

export const getTaskById = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const task = await Task.findOne({ _id: req.params.id, createdBy: userId }).populate(
      "assignedTo",
      "name email"
    );
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    return res.json({ success: true, task });
  } catch (error) {
    logger.error("task_get_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to fetch task" });
  }
};

export const getTaskByNumber = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const taskNumber = parseTaskNumber(req.params.task_number);
    if (!taskNumber) {
      return res.status(400).json({ success: false, message: "Invalid task number" });
    }

    const task = await taskService.getTaskByNumber(userId, taskNumber);
    return res.json({ success: true, task });
  } catch (error) {
    return handleTaskError(res, error, "[Task] get by number error");
  }
};

export const updateTask = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const {
      title,
      description,
      dueDate,
      status,
      priority,
      assignedTo,
      relatedToType,
      relatedToId,
      tags,
    } = req.body;

    if (relatedToType || relatedToId) {
      if (!validateRelatedInput(relatedToType, relatedToId)) {
        return res
          .status(400)
          .json({ success: false, message: "Both relatedToType and relatedToId are required" });
      }

      const relatedOk = await validateRelatedEntity(userId, relatedToType, relatedToId);
      if (!relatedOk) {
        return res.status(400).json({ success: false, message: "Related entity not found" });
      }
    }

    const task = await taskService.updateTask(userId, req.params.id, {
      title,
      description,
      dueDate,
      status: normalizeStatus(status),
      priority,
      assignedTo,
      relatedToType,
      relatedToId,
      tags,
    });
    return res.json({ success: true, task });
  } catch (error) {
    return handleTaskError(res, error, "[Task] update error");
  }
};

export const updateTaskByNumber = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const taskNumber = parseTaskNumber(req.params.task_number);
    if (!taskNumber) {
      return res.status(400).json({ success: false, message: "Invalid task number" });
    }
    const body = { ...(req.body || {}) };
    if (body.status) body.status = normalizeStatus(body.status);

    if (body.relatedToType || body.relatedToId) {
      if (!validateRelatedInput(body.relatedToType, body.relatedToId)) {
        return res
          .status(400)
          .json({ success: false, message: "Both relatedToType and relatedToId are required" });
      }
    }

    const task = await taskService.updateTaskFlexibleByNumber(userId, taskNumber, body);
    return res.json({ success: true, task });
  } catch (error) {
    return handleTaskError(res, error, "[Task] update by number error");
  }
};

export const updateTaskStatus = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, message: "Status is required" });
    }

    const task = await taskService.updateTask(userId, req.params.id, {
      status: normalizeStatus(status),
    });

    return res.json({ success: true, task });
  } catch (error) {
    return handleTaskError(res, error, "[Task] status update error");
  }
};

export const deleteTask = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    await taskService.deleteTask(userId, req.params.id);

    return res.json({ success: true, message: "Task deleted" });
  } catch (error) {
    return handleTaskError(res, error, "[Task] delete error");
  }
};

export const deleteTaskByNumber = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const taskNumber = parseTaskNumber(req.params.task_number);
    if (!taskNumber) {
      return res.status(400).json({ success: false, message: "Invalid task number" });
    }

    await taskService.deleteTaskByNumber(userId, taskNumber);
    return res.json({ success: true, message: "Task deleted" });
  } catch (error) {
    return handleTaskError(res, error, "[Task] delete by number error");
  }
};

export const assignTaskByNumber = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const taskNumber = parseTaskNumber(req.params.task_number);
    if (!taskNumber) {
      return res.status(400).json({ success: false, message: "Invalid task number" });
    }

    const { assigneeEmail, assigneeName, assignedTo } = req.body || {};
    const task = await taskService.assignTaskByNumber(
      userId,
      taskNumber,
      assigneeEmail,
      assignedTo,
      assigneeName
    );
    return res.json({ success: true, task });
  } catch (error) {
    return handleTaskError(res, error, "[Task] assign by number error");
  }
};

export const unassignTaskByNumber = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const taskNumber = parseTaskNumber(req.params.task_number);
    if (!taskNumber) {
      return res.status(400).json({ success: false, message: "Invalid task number" });
    }

    const task = await taskService.unassignTaskByNumber(userId, taskNumber);
    return res.json({ success: true, task });
  } catch (error) {
    return handleTaskError(res, error, "[Task] unassign by number error");
  }
};
