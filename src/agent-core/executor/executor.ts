import { Plan } from "../types";
import { toolRegistry } from "./toolRegistry";
import { logger } from "../../utils/logger";

export type ExecutionResult = {
  success: boolean;
  results: Array<{ action: string; output: Record<string, unknown> }>;
  error?: string;
};

export const executePlan = async (userId: string, plan: Plan): Promise<ExecutionResult> => {
  const results: Array<{ action: string; output: Record<string, unknown> }> = [];
  try {
    for (const step of plan.steps) {
      const result = await toolRegistry.execute(step.action, userId, step.data);
      results.push({ action: step.action, output: result.output });
    }

    return { success: true, results };
  } catch (error) {
    const last = results[results.length - 1];
    if (last) {
      try {
        await toolRegistry.rollback(last.action as any, userId, last.output);
      } catch (rollbackError) {
        logger.error("agent_rollback_failed", {
          error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        });
      }
    }

    return {
      success: false,
      results,
      error: error instanceof Error ? error.message : "Execution failed",
    };
  }
};
