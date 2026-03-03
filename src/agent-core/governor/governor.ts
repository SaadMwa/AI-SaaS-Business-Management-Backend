import { AgentContext, IntentResult, Plan, RiskLevel } from "../types";
import { ACTION_ROLE_REQUIREMENTS } from "./permissions";
import { scoreRisk } from "./riskScoring";
import { memoryService } from "../memory/memoryService";

export type GovernanceResult = {
  allowed: boolean;
  requiresConfirmation: boolean;
  riskLevel: RiskLevel;
  message?: string;
};

export const evaluateGovernance = async (
  intent: IntentResult,
  plan: Plan,
  context: AgentContext
): Promise<GovernanceResult> => {
  const firstAction = plan.steps[0]?.action || "chat";
  const riskLevel = scoreRisk(firstAction);

  if (intent.confidence < 0.7) {
    return {
      allowed: false,
      requiresConfirmation: false,
      riskLevel,
      message: "I need more detail to be confident about this action. Could you clarify?",
    };
  }

  if (!context.userId && firstAction !== "normal_chat" && firstAction !== "chat") {
    return {
      allowed: false,
      requiresConfirmation: false,
      riskLevel,
      message: "I need a user context to perform that action. Please provide your userId.",
    };
  }

  if (context.role) {
    const allowedRoles = ACTION_ROLE_REQUIREMENTS[firstAction] || ["admin"];
    if (!allowedRoles.includes(context.role as any)) {
      return {
        allowed: false,
        requiresConfirmation: false,
        riskLevel,
        message: `Your role (${context.role}) does not allow this action.`,
      };
    }
  }

  const destructive = riskLevel === "high";
  if (destructive) {
    return {
      allowed: true,
      requiresConfirmation: true,
      riskLevel,
      message: "This action is destructive. Please confirm to proceed.",
    };
  }

  return { allowed: true, requiresConfirmation: false, riskLevel };
};

export const checkPendingConfirmation = async (context: AgentContext, normalizedText: string) => {
  if (!context.userId || !context.sessionId) return null;
  const pending = await memoryService.getPendingConfirmation(context.userId, context.sessionId);
  if (!pending) return null;

  if (/(confirm|yes|approve|go ahead)/i.test(normalizedText)) {
    await memoryService.clearPendingConfirmation(context.userId, context.sessionId);
    return pending;
  }

  if (/(cancel|no|stop)/i.test(normalizedText)) {
    await memoryService.clearPendingConfirmation(context.userId, context.sessionId);
    return { cancelled: true };
  }

  return null;
};

export const savePendingConfirmation = async (context: AgentContext, payload: Record<string, unknown>) => {
  if (!context.userId) return;
  await memoryService.savePendingConfirmation(
    context.userId,
    context.sessionId || "default",
    payload
  );
};
