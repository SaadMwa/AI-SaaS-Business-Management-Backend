import { AgentEvent } from "../../models/agentEvent";
import { AgentMemory } from "../../models/agentMemory";
import { Task } from "../../models/task";
import { EVENT_THRESHOLDS } from "./triggers";

const shouldCreateEvent = async (userId: string, type: string) => {
  const recent = await AgentEvent.findOne({ userId, type })
    .sort({ createdAt: -1 })
    .lean();
  if (!recent) return true;
  const age = Date.now() - new Date(recent.createdAt as any).getTime();
  return age > 24 * 60 * 60 * 1000;
};

export const runEventTriggers = async (userId: string) => {
  const now = new Date();
  const overdueCount = await Task.countDocuments({
    createdBy: userId,
    status: { $ne: "done" },
    dueDate: { $lt: now },
  });

  if (overdueCount >= EVENT_THRESHOLDS.overdueTasks && (await shouldCreateEvent(userId, "task_overdue"))) {
    await AgentEvent.create({
      userId,
      type: "task_overdue",
      payload: { overdueCount },
    });
  }

  const urgentCount = await Task.countDocuments({
    createdBy: userId,
    status: { $ne: "done" },
    priority: { $in: ["high", "urgent"] },
  });

  if (urgentCount >= EVENT_THRESHOLDS.workloadSpike && (await shouldCreateEvent(userId, "workload_spike"))) {
    await AgentEvent.create({
      userId,
      type: "workload_spike",
      payload: { urgentCount },
    });
  }

  const lastInteraction = await AgentMemory.findOne({ userId, type: "short_term" })
    .sort({ createdAt: -1 })
    .lean();
  if (lastInteraction) {
    const idleDays = (Date.now() - new Date(lastInteraction.createdAt as any).getTime()) / (24 * 60 * 60 * 1000);
    if (idleDays >= EVENT_THRESHOLDS.idleDays && (await shouldCreateEvent(userId, "user_idle"))) {
      await AgentEvent.create({
        userId,
        type: "user_idle",
        payload: { idleDays: Math.floor(idleDays) },
      });
    }
  }
};
