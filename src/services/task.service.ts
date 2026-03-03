import mongoose from "mongoose";
import { Task } from "../models/task";
import { User } from "../models/user";
import { AuditLog } from "../models/auditLog";
import { TaskHistory } from "../models/taskHistory";
import { Customer } from "../models/customer";
import { Sale } from "../models/sale";
import { getNextSequence } from "./counter.service";
import { historyService } from "./history.service";

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

const findUserByEmail = async (email?: string) => {
  if (!email || typeof email !== "string") return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return User.findOne({ email: { $regex: `^${escaped}$`, $options: "i" } })
    .select("_id")
    .lean();
};

const findUserByName = async (name?: string) => {
  if (!name || typeof name !== "string") return null;
  const normalized = name.trim();
  if (!normalized) return null;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return User.findOne({ name: { $regex: `^${escaped}$`, $options: "i" } })
    .select("_id")
    .lean();
};

const resolveAssignee = async (params: {
  assigneeEmail?: string;
  assigneeId?: string;
  assigneeName?: string;
}) => {
  if (params.assigneeId) {
    const user = await User.findById(params.assigneeId).select("_id").lean();
    if (!user) throw new Error("Assignee not found");
    return user._id.toString();
  }
  if (params.assigneeEmail) {
    const user = await findUserByEmail(params.assigneeEmail);
    if (!user) throw new Error("Assignee not found");
    return user._id.toString();
  }
  if (params.assigneeName) {
    const user = await findUserByName(params.assigneeName);
    if (!user) throw new Error("Assignee not found");
    return user._id.toString();
  }
  return undefined;
};

const normalizeStatus = (value?: string) => {
  if (!value) return value;
  if (value === "in-progress") return "in_progress";
  return value;
};

const buildSnapshot = (task: any) => ({
  task_number: task.task_number,
  title: task.title,
  description: task.description,
  status: task.status,
  priority: task.priority,
  dueDate: task.dueDate,
  assignedTo: task.assignedTo,
  relatedToType: task.relatedToType,
  relatedToId: task.relatedToId,
  tags: task.tags,
});

const recordTaskHistory = async (params: {
  taskId: string;
  task_number: number;
  userId: string;
  action: "created" | "updated" | "status_changed" | "priority_changed" | "assigned" | "deleted";
  changes?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
}) => {
  await TaskHistory.create({
    taskId: params.taskId,
    task_number: params.task_number,
    userId: params.userId,
    action: params.action,
    changes: params.changes || {},
    snapshot: params.snapshot || {},
  });
};

const recordAuditLog = async (params: {
  userId: string;
  entityId: string;
  task_number: number;
  action: "created" | "updated" | "assigned" | "deleted" | "status_changed" | "priority_changed";
  summary: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}) => {
  await AuditLog.create({
    userId: params.userId,
    entityType: "task",
    entityId: params.entityId,
    task_number: params.task_number,
    action: params.action,
    summary: params.summary,
    before: params.before || {},
    after: params.after || {},
    meta: params.meta || {},
  });
};

const getMaxTaskNumber = async (userId: string) => {
  const latest = await Task.findOne({ createdBy: userId })
    .sort({ task_number: -1 })
    .select("task_number")
    .lean();
  return latest?.task_number || 0;
};

const getNextTaskNumber = async (userId: string) => {
  return getNextSequence(userId, "task", () => getMaxTaskNumber(userId));
};

const ensureTaskNumbers = async (userId: string, tasks: any[]) => {
  const missing = tasks.filter((task) => !task.task_number);
  if (!missing.length) return tasks;

  let next = await getNextTaskNumber(userId);
  for (const task of missing) {
    task.task_number = next;
    await Task.updateOne({ _id: task._id }, { $set: { task_number: next } });
    next += 1;
  }

  return tasks.sort((a, b) => (a.task_number || 0) - (b.task_number || 0));
};

const validateRelatedEntity = async (
  userId: string,
  relatedToType?: string,
  relatedToId?: string
) => {
  if (!relatedToType || !relatedToId) return true;
  if (relatedToType === "customer") {
    const customer = await Customer.findOne({ _id: relatedToId, createdBy: userId }).select("_id");
    return Boolean(customer);
  }
  if (relatedToType === "sale") {
    const sale = await Sale.findOne({ _id: relatedToId, createdBy: userId }).select("_id");
    return Boolean(sale);
  }
  return false;
};

const getPerformedBy = (payload?: Record<string, unknown>) => {
  const value = payload?.performedBy || payload?._performedBy;
  return value === "ai" ? "ai" : "user";
};

export const taskService = {
  listTasks: async (userId: string, filters?: Record<string, unknown>) => {
    const normalizedFilters = { ...(filters || {}) } as Record<string, unknown>;
    if (normalizedFilters.status === "in_progress") {
      normalizedFilters.status = { $in: ["in_progress", "in-progress"] };
    }
    const query = { createdBy: userId, ...normalizedFilters } as Record<string, unknown>;
    const tasks = await Task.find(query)
      .sort({ task_number: 1, createdAt: -1 })
      .populate("assignedTo", "name email");
    return ensureTaskNumbers(userId, tasks as any[]);
  },

  getTaskByNumber: async (userId: string, taskNumber: number) => {
    const task = await Task.findOne({ createdBy: userId, task_number: taskNumber }).populate(
      "assignedTo",
      "name email"
    );
    if (!task) throw new Error("Task not found");
    return task;
  },

  createTask: async (userId: string, data: Record<string, unknown>) => {
    const raw_input =
      (data.raw_input as string) ||
      (data.rawInput as string) ||
      (data.rawText as string) ||
      (data.title as string) ||
      "";
    const title = (data.title as string) || raw_input;
    if (!title) throw new Error("Task title is required");

    const tags =
      Array.isArray(data.tags) && data.tags.length
        ? (data.tags as string[])
        : autoTagFromText([title, data.description].filter(Boolean).join(" "));

    let assignedTo = data.assignedTo as string | undefined;
    if (!assignedTo && (data.assigneeEmail || data.assigneeName)) {
      assignedTo = await resolveAssignee({
        assigneeEmail: data.assigneeEmail as string | undefined,
        assigneeName: data.assigneeName as string | undefined,
      });
    }
    if (assignedTo) {
      const user = await User.findById(assignedTo).select("_id").lean();
      if (!user) throw new Error("Assignee not found");
    }

    const status = normalizeStatus(data.status as string) || "todo";
    const priority = (data.priority as string) || "medium";

    let task;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const task_number = await getNextTaskNumber(userId);
        task = await Task.create({
          task_number,
          raw_input,
          parsed_input: data.parsed_input || {},
          title,
          description: data.description || "",
          priority,
          status,
          dueDate: data.dueDate ? new Date(data.dueDate as string) : undefined,
          assignedTo: assignedTo ? new mongoose.Types.ObjectId(assignedTo) : undefined,
          relatedToType: data.relatedToType,
          relatedToId: data.relatedToId,
          tags,
          createdBy: new mongoose.Types.ObjectId(userId),
          meta: data.meta || {},
        });
        break;
      } catch (error: any) {
        if (error?.code === 11000 && attempt < 2) continue;
        throw error;
      }
    }

    if (!task) throw new Error("Failed to create task");
    await task.populate("assignedTo", "name email");

    await recordTaskHistory({
      taskId: task._id.toString(),
      task_number: task.task_number,
      userId,
      action: "created",
      snapshot: buildSnapshot(task),
    });
    await recordAuditLog({
      userId,
      entityId: task._id.toString(),
      task_number: task.task_number,
      action: "created",
      summary: `Created task #${task.task_number}`,
      after: buildSnapshot(task),
    });

    await historyService.logAction({
      userId,
      entityType: "task",
      entityNumber: task.task_number,
      action: "create",
      performedBy: getPerformedBy(data),
      meta: { title: task.title },
    });

    return task;
  },

  updateTask: async (userId: string, taskId: string | undefined, data: Record<string, unknown>) => {
    const task = taskId ? await Task.findOne({ _id: taskId, createdBy: userId }) : null;
    if (!task) throw new Error("Task not found");

    const before = buildSnapshot(task);
    let action: "updated" | "status_changed" | "priority_changed" = "updated";

    if (data.title) task.title = data.title as string;
    if (typeof data.description !== "undefined") {
      task.description = data.description === null ? undefined : (data.description as string);
    }
    if (data.status) {
      task.status = normalizeStatus(data.status as string) as any;
      action = "status_changed";
    }
    if (data.priority) {
      task.priority = data.priority as any;
      action = action === "status_changed" ? "updated" : "priority_changed";
    }
    if (typeof data.dueDate !== "undefined") {
      task.dueDate = data.dueDate ? new Date(data.dueDate as string) : undefined;
    }
    if (typeof data.assignedTo !== "undefined") {
      if (data.assignedTo) {
        const user = await User.findById(data.assignedTo as string).select("_id").lean();
        if (!user) throw new Error("Assignee not found");
        task.assignedTo = new mongoose.Types.ObjectId(data.assignedTo as string);
      } else {
        task.assignedTo = undefined;
      }
    }
    if (Array.isArray(data.tags)) {
      task.tags = data.tags as string[];
    } else if (!task.tags || task.tags.length === 0) {
      task.tags = autoTagFromText([task.title, task.description].filter(Boolean).join(" "));
    }
    if (data.relatedToType || data.relatedToId) {
      const ok = await validateRelatedEntity(
        userId,
        data.relatedToType as string | undefined,
        data.relatedToId as string | undefined
      );
      if (!ok) throw new Error("Related entity not found");
      task.relatedToType = data.relatedToType as any;
      task.relatedToId = data.relatedToId as any;
    }
    if (!task.task_number) {
      task.task_number = await getNextTaskNumber(userId);
    }

    await task.save();
    await task.populate("assignedTo", "name email");

    const after = buildSnapshot(task);
    await recordTaskHistory({
      taskId: task._id.toString(),
      task_number: task.task_number,
      userId,
      action,
      changes: { before, after },
      snapshot: after,
    });
    await recordAuditLog({
      userId,
      entityId: task._id.toString(),
      task_number: task.task_number,
      action,
      summary: `Updated task #${task.task_number}`,
      before,
      after,
    });

    await historyService.logAction({
      userId,
      entityType: "task",
      entityNumber: task.task_number,
      action: "update",
      performedBy: getPerformedBy(data),
    });

    return task;
  },

  updateTaskByNumber: async (
    userId: string,
    taskNumber: number,
    data: Record<string, unknown>
  ) => {
    return taskService.updateTaskFlexibleByNumber(userId, taskNumber, data);
  },

  deleteTask: async (userId: string, taskId: string) => {
    const task = await Task.findOneAndDelete({ _id: taskId, createdBy: userId });
    if (!task) throw new Error("Task not found");

    await recordTaskHistory({
      taskId: task._id.toString(),
      task_number: task.task_number,
      userId,
      action: "deleted",
      snapshot: buildSnapshot(task),
    });
    await recordAuditLog({
      userId,
      entityId: task._id.toString(),
      task_number: task.task_number,
      action: "deleted",
      summary: `Deleted task #${task.task_number}`,
      before: buildSnapshot(task),
    });

    await historyService.logAction({
      userId,
      entityType: "task",
      entityNumber: task.task_number,
      action: "delete",
      performedBy: "user",
    });

    return task;
  },

  deleteTaskByNumber: async (
    userId: string,
    taskNumber: number,
    performedBy: "user" | "ai" = "user"
  ) => {
    const task = await Task.findOneAndDelete({ createdBy: userId, task_number: taskNumber });
    if (!task) throw new Error("Task not found");

    await recordTaskHistory({
      taskId: task._id.toString(),
      task_number: task.task_number,
      userId,
      action: "deleted",
      snapshot: buildSnapshot(task),
    });
    await recordAuditLog({
      userId,
      entityId: task._id.toString(),
      task_number: task.task_number,
      action: "deleted",
      summary: `Deleted task #${task.task_number}`,
      before: buildSnapshot(task),
    });

    await historyService.logAction({
      userId,
      entityType: "task",
      entityNumber: task.task_number,
      action: "delete",
      performedBy,
    });

    return task;
  },

  assignTask: async (
    userId: string,
    taskId: string,
    assigneeEmail?: string,
    assigneeId?: string,
    assigneeName?: string
  ) => {
    const assignedTo = await resolveAssignee({ assigneeEmail, assigneeId, assigneeName });
    if (!assignedTo) throw new Error("Assignee is required");
    const task = await Task.findOne({ _id: taskId, createdBy: userId });
    if (!task) throw new Error("Task not found");
    if (!task.task_number) {
      task.task_number = await getNextTaskNumber(userId);
    }
    task.assignedTo = new mongoose.Types.ObjectId(assignedTo);
    await task.save();
    await task.populate("assignedTo", "name email");

    await recordTaskHistory({
      taskId: task._id.toString(),
      task_number: task.task_number,
      userId,
      action: "assigned",
      changes: { assignedTo },
      snapshot: buildSnapshot(task),
    });
    await recordAuditLog({
      userId,
      entityId: task._id.toString(),
      task_number: task.task_number,
      action: "assigned",
      summary: `Assigned task #${task.task_number}`,
      after: buildSnapshot(task),
    });

    await historyService.logAction({
      userId,
      entityType: "task",
      entityNumber: task.task_number,
      action: "assign",
      performedBy: "user",
    });

    return task;
  },

  assignTaskByNumber: async (
    userId: string,
    taskNumber: number,
    assigneeEmail?: string,
    assigneeId?: string,
    assigneeName?: string,
    performedBy: "user" | "ai" = "user"
  ) => {
    const task = await Task.findOne({ createdBy: userId, task_number: taskNumber });
    if (!task) throw new Error("Task not found");
    const assigned = await taskService.assignTask(
      userId,
      task._id.toString(),
      assigneeEmail,
      assigneeId,
      assigneeName
    );
    await historyService.logAction({
      userId,
      entityType: "task",
      entityNumber: task.task_number,
      action: "assign",
      performedBy,
    });
    return assigned;
  },

  unassignTaskByNumber: async (userId: string, taskNumber: number) => {
    const task = await Task.findOne({ createdBy: userId, task_number: taskNumber });
    if (!task) throw new Error("Task not found");
    if (!task.task_number) {
      task.task_number = await getNextTaskNumber(userId);
    }
    task.set("assignedTo", null);
    await task.save();
    await task.populate("assignedTo", "name email");

    await recordTaskHistory({
      taskId: task._id.toString(),
      task_number: task.task_number,
      userId,
      action: "assigned",
      changes: { assignedTo: null },
      snapshot: buildSnapshot(task),
    });
    await recordAuditLog({
      userId,
      entityId: task._id.toString(),
      task_number: task.task_number,
      action: "assigned",
      summary: `Unassigned task #${task.task_number}`,
      after: buildSnapshot(task),
    });

    await historyService.logAction({
      userId,
      entityType: "task",
      entityNumber: task.task_number,
      action: "unassign",
      performedBy: "user",
    });

    return task;
  },

  updateTaskFlexibleByNumber: async (
    userId: string,
    taskNumber: number,
    updates: Record<string, unknown>
  ) => {
    const task = await Task.findOne({ createdBy: userId, task_number: taskNumber });
    if (!task) throw new Error("Task not found");

    const before = buildSnapshot(task);
    let action: "updated" | "status_changed" | "priority_changed" = "updated";

    const handledKeys = new Set<string>();

    if (typeof updates.title === "string") {
      task.title = updates.title;
      handledKeys.add("title");
    }
    if (typeof updates.description !== "undefined") {
      task.description = updates.description === null ? undefined : (updates.description as string);
      handledKeys.add("description");
    }
    if (typeof updates.raw_input !== "undefined") {
      task.raw_input = updates.raw_input as string;
      handledKeys.add("raw_input");
    }
    if (typeof updates.parsed_input !== "undefined") {
      task.parsed_input = updates.parsed_input as any;
      handledKeys.add("parsed_input");
    }
    if (typeof updates.meta !== "undefined") {
      task.meta = updates.meta as any;
      handledKeys.add("meta");
    }
    if (updates.status) {
      task.status = normalizeStatus(updates.status as string) as any;
      action = "status_changed";
      handledKeys.add("status");
    }
    if (updates.priority) {
      task.priority = updates.priority as any;
      action = action === "status_changed" ? "updated" : "priority_changed";
      handledKeys.add("priority");
    }
    if (typeof updates.dueDate !== "undefined") {
      task.dueDate = updates.dueDate ? new Date(updates.dueDate as string) : undefined;
      handledKeys.add("dueDate");
    }
    if (Array.isArray(updates.tags)) {
      task.tags = updates.tags as string[];
      handledKeys.add("tags");
    }

    const relatedToType = updates.relatedToType as string | undefined;
    const relatedToId = updates.relatedToId as string | undefined;
    if (relatedToType || relatedToId) {
      const ok = await validateRelatedEntity(userId, relatedToType, relatedToId);
      if (!ok) throw new Error("Related entity not found");
      task.relatedToType = relatedToType as any;
      task.relatedToId = relatedToId as any;
      handledKeys.add("relatedToType");
      handledKeys.add("relatedToId");
    }

    if (typeof updates.assignedTo !== "undefined" || updates.assigneeEmail || updates.assigneeName) {
      if (updates.assignedTo === null) {
        task.assignedTo = undefined;
      } else {
        const resolved = await resolveAssignee({
          assigneeEmail: updates.assigneeEmail as string | undefined,
          assigneeId: updates.assignedTo as string | undefined,
          assigneeName: updates.assigneeName as string | undefined,
        });
        if (!resolved) throw new Error("Assignee not found");
        task.assignedTo = new mongoose.Types.ObjectId(resolved);
      }
      handledKeys.add("assignedTo");
      handledKeys.add("assigneeEmail");
      handledKeys.add("assigneeName");
    }

    const blockedKeys = new Set([
      "_id",
      "createdBy",
      "task_number",
      "taskNumber",
      "createdAt",
      "updatedAt",
      "__v",
    ]);
    Object.entries(updates).forEach(([key, value]) => {
      if (handledKeys.has(key) || blockedKeys.has(key)) return;
      (task as any)[key] = value;
    });

    if (!task.task_number) {
      task.task_number = await getNextTaskNumber(userId);
    }

    await task.save();
    await task.populate("assignedTo", "name email");

    const after = buildSnapshot(task);
    await recordTaskHistory({
      taskId: task._id.toString(),
      task_number: task.task_number,
      userId,
      action,
      changes: { before, after },
      snapshot: after,
    });
    await recordAuditLog({
      userId,
      entityId: task._id.toString(),
      task_number: task.task_number,
      action,
      summary: `Updated task #${task.task_number}`,
      before,
      after,
    });

    await historyService.logAction({
      userId,
      entityType: "task",
      entityNumber: task.task_number,
      action: "update",
      performedBy: getPerformedBy(updates),
    });

    return task;
  },

  reprioritizeTasks: async (userId: string, priority: string) => {
    const result = await Task.updateMany(
      { createdBy: userId, status: { $ne: "done" } },
      { $set: { priority } }
    );
    return { updated: result.modifiedCount };
  },

  optimizeWorkload: async (userId: string) => {
    const tasks = await Task.find({ createdBy: userId, status: { $ne: "done" } })
      .populate("assignedTo", "name email")
      .lean();

    const workload = new Map<string, number>();
    tasks.forEach((task) => {
      const key = task.assignedTo?._id?.toString() || "unassigned";
      workload.set(key, (workload.get(key) || 0) + 1);
    });

    const suggestions: string[] = [];
    const entries = Array.from(workload.entries()).sort((a, b) => b[1] - a[1]);
    if (entries.length > 1 && entries[0][1] - entries[entries.length - 1][1] >= 3) {
      suggestions.push("Rebalance tasks from the busiest owner to lighter owners.");
    }
    if (workload.get("unassigned")) {
      suggestions.push("Assign owners to unassigned tasks to reduce bottlenecks.");
    }

    return { workload: Object.fromEntries(workload), suggestions };
  },

  schedulePlan: async (userId: string, tasks: Array<{ title: string; dueDate?: string }>) => {
    if (!Array.isArray(tasks) || tasks.length === 0) {
      throw new Error("Provide tasks to schedule");
    }

    const created = [];
    for (const task of tasks) {
      created.push(
        await taskService.createTask(userId, {
          title: task.title,
          dueDate: task.dueDate,
          priority: "medium",
        })
      );
    }

    return created;
  },

  negotiateDeadline: async (userId: string, taskId: string, dueDate: string) => {
    return taskService.updateTask(userId, taskId, { dueDate });
  },

  autoTagTasks: async (userId: string) => {
    const tasks = await Task.find({ createdBy: userId }).select("title description tags").lean();
    let updated = 0;
    for (const task of tasks) {
      if (task.tags && task.tags.length) continue;
      const tags = autoTagFromText([task.title, task.description].filter(Boolean).join(" "));
      if (tags.length) {
        await Task.updateOne({ _id: task._id }, { $set: { tags } });
        updated += 1;
      }
    }
    return { updated, total: tasks.length };
  },

  getTaskSummary: async (userId: string) => {
    const tasks = await Task.find({ createdBy: userId })
      .sort({ createdAt: -1 })
      .limit(200)
      .select("title description dueDate status priority tags assignedTo createdAt task_number")
      .populate("assignedTo", "name email")
      .lean();

    const now = new Date();
    const dueSoon = new Date();
    dueSoon.setDate(dueSoon.getDate() + 7);

    const tasksByStatus = tasks.reduce(
      (acc, task) => {
        const status = normalizeStatus(task.status) || task.status;
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      },
      { todo: 0, in_progress: 0, blocked: 0, done: 0 } as Record<string, number>
    );

    const overdueTasks = tasks.filter(
      (task) =>
        task.status !== "done" &&
        task.dueDate &&
        new Date(task.dueDate).getTime() < now.getTime()
    ).length;

    const dueSoonTasks = tasks.filter(
      (task) =>
        task.status !== "done" &&
        task.dueDate &&
        new Date(task.dueDate).getTime() >= now.getTime() &&
        new Date(task.dueDate).getTime() <= dueSoon.getTime()
    ).length;

    const highPriorityTasks = tasks.filter(
      (task) => task.status !== "done" && task.priority === "high"
    ).length;

    const urgentTasks = tasks.filter(
      (task) => task.status !== "done" && task.priority === "urgent"
    ).length;

    const unassignedTasks = tasks.filter((task) => !task.assignedTo).length;

    const tagCounts = new Map<string, number>();
    tasks.forEach((task) => {
      (task.tags || []).forEach((tag) => {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      });
    });
    const topTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag, count]) => ({ tag, count }));

    return {
      totalTasks: tasks.length,
      tasksByStatus,
      overdueTasks,
      dueSoonTasks,
      highPriorityTasks,
      urgentTasks,
      unassignedTasks,
      topTags,
      recentTasks: tasks.slice(0, 5),
    };
  },
};
