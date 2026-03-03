import { AgentContext, IntentResult } from "../types";
import { memoryService } from "../memory/memoryService";

export const reflectOutcome = async (
  context: AgentContext,
  intent: IntentResult,
  summary: Record<string, unknown>
) => {
  if (!context.userId) return;

  const key = `intent:${intent.intent}`;
  await memoryService.addLongTerm(context.userId, key, JSON.stringify(summary), {
    intent: intent.intent,
    confidence: intent.confidence,
  });
};
