import { AgentContext, IntentResult, Plan } from "../types";
import { executePlan } from "../executor/executor";
import { reflectOutcome } from "../reflection/reflection";
import { AgentLog } from "../../models/agentLog";

export const runManagerAgent = async (
  intent: IntentResult,
  plan: Plan,
  context: AgentContext
) => {
  if (!context.userId) throw new Error("UserId required for execution");

  const log = await AgentLog.create({
    userId: context.userId,
    sessionId: context.sessionId,
    intent: intent.intent,
    status: "pending",
    confidence: intent.confidence,
  });

  const execution = await executePlan(context.userId, plan);

  await AgentLog.findByIdAndUpdate(log._id, {
    status: execution.success ? "success" : "failed",
    completedAt: new Date(),
    output: execution,
    error: execution.error,
  });

  await reflectOutcome(context, intent, execution);

  return execution;
};
