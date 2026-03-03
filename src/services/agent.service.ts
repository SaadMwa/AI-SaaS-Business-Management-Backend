import mongoose from "mongoose";
import { User } from "../models/user";
import { perceiveInput } from "../agent-core/perception/perception";
import { detectIntent } from "../agent-core/intent/intentEngine";
import { buildPlan } from "../agent-core/planner/planner";
import { evaluatePlan } from "../agent-core/reasoner/reasoner";
import {
  checkPendingConfirmation,
  evaluateGovernance,
  savePendingConfirmation,
} from "../agent-core/governor/governor";
import { runManagerAgent } from "../agent-core/orchestrator/managerAgent";
import { memoryService } from "../agent-core/memory/memoryService";
import { runEventTriggers } from "../agent-core/events/eventEngine";
import { taskService } from "./task.service";
import { getDashboardMetrics } from "./analytics.service";
import { IntentResult } from "../agent-core/types";
import { UserMessage } from "../models/userMessage";
import { interpretIntentWithLLM } from "./ai.service";
import { logger } from "../utils/logger";

export type AgentResponse = {
  handled: boolean;
  answer?: string;
  businessData?: Record<string, unknown> | null;
};

const makeStructuredAnswer = (answer: string, evidence: string[], nextSteps: string[]) => {
  const safeEvidence = evidence.length ? evidence : ["No supporting data available."];
  const safeNext = nextSteps.length ? nextSteps : ["Add more business data for richer insights."];
  return [
    `Answer: ${answer}`,
    "Evidence:",
    ...safeEvidence.map((item) => `- ${item}`),
    "Next steps:",
    ...safeNext.map((item) => `- ${item}`),
  ].join("\n");
};

const formatISODate = (value?: string) => {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toISOString().split("T")[0];
};

const summarizeExecution = (intent: IntentResult, results: Array<{ action: string; output: any }>) => {
  const primary = results[0];
  if (!primary) return "No actions executed.";

  switch (intent.intent) {
    case "create_task":
      return `Created task #${primary.output.task?.taskNumber || primary.output.task?.task_number || "?"} "${
        primary.output.task?.title || "(untitled)"
      }".`;
    case "update_task":
      return `Updated task #${primary.output.task?.taskNumber || primary.output.task?.task_number || "?"}.`;
    case "delete_task":
      return `Deleted task #${primary.output.task?.taskNumber || primary.output.task?.task_number || "?"}.`;
    case "assign_task":
      return `Assigned task #${primary.output.task?.taskNumber || primary.output.task?.task_number || "?"}.`;
    case "change_status":
      return `Updated status for task #${primary.output.task?.taskNumber || primary.output.task?.task_number || "?"}.`;
    case "change_priority":
      return `Updated priority for task #${primary.output.task?.taskNumber || primary.output.task?.task_number || "?"}.`;
    case "list_tasks":
      return `Found ${primary.output.tasks?.length || 0} tasks.`;
    case "create_customer":
      return `Created customer ${primary.output.customer?.customerNumber ?? primary.output.customer?.customer_number ?? ""} "${
        primary.output.customer?.name || "(unnamed)"
      }".`;
    case "update_customer":
      return `Updated customer ${primary.output.customer?.customerNumber ?? primary.output.customer?.customer_number ?? ""}.`;
    case "delete_customer":
      return `Deleted customer ${primary.output.customer?.customerNumber ?? primary.output.customer?.customer_number ?? ""}.`;
    case "view_customer":
      return `Fetched customer ${primary.output.customer?.customerNumber ?? primary.output.customer?.customer_number ?? ""}.`;
    case "list_customers":
      return `Found ${primary.output.customers?.length || 0} customers.`;
    case "create_sale":
      return `Created sale ${primary.output.sale?.saleNumber ?? primary.output.sale?.sale_number ?? ""}.`;
    case "update_sale":
      return `Updated sale ${primary.output.sale?.saleNumber ?? primary.output.sale?.sale_number ?? ""}.`;
    case "delete_sale":
      return `Deleted sale ${primary.output.sale?.saleNumber ?? primary.output.sale?.sale_number ?? ""}.`;
    case "view_sale":
      return `Fetched sale ${primary.output.sale?.saleNumber ?? primary.output.sale?.sale_number ?? ""}.`;
    case "assign_sale":
      return `Assigned sale ${primary.output.sale?.saleNumber ?? primary.output.sale?.sale_number ?? ""}.`;
    case "change_sale_status":
      return `Updated status for sale ${primary.output.sale?.saleNumber ?? primary.output.sale?.sale_number ?? ""}.`;
    case "list_sales":
      return `Found ${primary.output.sales?.length || 0} sales.`;
    case "reprioritize_tasks":
      return `Updated priorities for ${primary.output.result?.updated || 0} tasks.`;
    case "optimize_workload":
      return "Analyzed workload distribution.";
    case "generate_report":
      return "Generated a management report.";
    case "analyze_productivity":
      return "Analyzed productivity metrics.";
    case "detect_risk":
      return "Detected operational risks.";
    case "automate_workflow":
      return `Automated workflow (auto-tagged ${primary.output.autoTag?.updated || 0} tasks).`;
    case "negotiate_deadline":
      return `Updated due date to ${formatISODate(primary.output.task?.dueDate)}.`;
    case "strategic_planning":
      return "Prepared strategic planning insights.";
    default:
      return "Completed the requested action.";
  }
};

const buildManagementInsights = async (userId: string) => {
  const taskSummary = await taskService.getTaskSummary(userId);
  const metrics = await getDashboardMetrics(userId);
  const insights = [] as string[];

  if (taskSummary.urgentTasks + taskSummary.highPriorityTasks >= 5) {
    insights.push("You have 5+ high-priority tasks. Consider delegating or deferring low impact items.");
  }
  if (taskSummary.overdueTasks > 0) {
    insights.push(`There are ${taskSummary.overdueTasks} overdue tasks. Address blockers today.`);
  }
  if (taskSummary.tasksByStatus?.blocked && taskSummary.tasksByStatus.blocked > 0) {
    insights.push(`You have ${taskSummary.tasksByStatus.blocked} blocked tasks. Capture blockers and unblock them.`);
  }
  if (taskSummary.unassignedTasks > 0) {
    insights.push("Assign owners to unassigned tasks to prevent delays.");
  }
  const openTasks =
    (taskSummary.totalTasks || 0) - (taskSummary.tasksByStatus?.done || 0);
  if (openTasks >= 15) {
    insights.push("Your workload is heavy. Consider rebalancing or deferring lower-impact tasks.");
  }
  if (metrics.completionRate < 60) {
    insights.push("Task completion rate is below 60%. Break large tasks into smaller milestones.");
  }

  return { taskSummary, metrics, insights };
};

export const runAgent = async (params: {
  question: string;
  rawText?: string;
  userId?: string;
  sessionId?: string;
  performedBy?: "user" | "ai";
}): Promise<AgentResponse> => {
  const rawText = params.rawText || params.question;
  const unsafePatterns = [
    /\brm\s+-rf\b/i,
    /\bsudo\b/i,
    /\bchmod\s+777\b/i,
    /\bdel\s+\/f\b/i,
    /\bformat\s+\w:/i,
    /\bshutdown\b/i,
  ];
  if (unsafePatterns.some((pattern) => pattern.test(rawText))) {
    return {
      handled: true,
      answer: "I can’t help with that request.",
      businessData: null,
    };
  }
  const perception = perceiveInput(rawText);
  const context = {
    userId: params.userId,
    sessionId: params.sessionId || "default",
  } as { userId?: string; sessionId?: string; role?: "user" | "admin" | "moderator" };

  if (context.userId && mongoose.Types.ObjectId.isValid(context.userId)) {
    const user = await User.findById(context.userId).select("role").lean();
    if (user?.role) context.role = user.role as any;
  }

  if (context.userId) {
    await UserMessage.create({
      userId: context.userId,
      rawText,
      normalizedText: perception.normalized,
      channel: "ai",
    });

    await memoryService.addShortTerm(context.userId, context.sessionId || "default", rawText, {
      ts: new Date().toISOString(),
    });

    if (rawText.trim().length > 10) {
      try {
        await memoryService.addSemantic(context.userId, rawText, {
          ts: new Date().toISOString(),
        });
      } catch (error) {
        logger.warn("agent_semantic_memory_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const pending = await checkPendingConfirmation(context, perception.normalized);
  if (pending?.cancelled) {
    return { handled: true, answer: "Understood. I will not proceed with that action.", businessData: null };
  }

  if (pending?.plan && context.userId) {
    const execution = await runManagerAgent(pending.intent as IntentResult, pending.plan, context);
    const summary = summarizeExecution(pending.intent as IntentResult, execution.results);
    return {
      handled: true,
      answer: makeStructuredAnswer(summary, ["confirmation=approved"], ["Review the updated tasks."]),
      businessData: { execution },
    };
  }

  const heuristicIntent = detectIntent(perception);
  let intent = heuristicIntent;
  try {
    const llmIntent = await interpretIntentWithLLM(rawText);
    const allowedLLMIntents = new Set([
      "create_task",
      "update_task",
      "delete_task",
      "assign_task",
      "change_status",
      "change_priority",
      "list_tasks",
      "chat",
      "create_customer",
      "update_customer",
      "delete_customer",
      "view_customer",
      "list_customers",
      "create_sale",
      "update_sale",
      "delete_sale",
      "view_sale",
      "assign_sale",
      "change_sale_status",
      "list_sales",
    ]);
    if (llmIntent && allowedLLMIntents.has(llmIntent.intent)) {
      if (llmIntent.intent !== "chat" || ["chat", "normal_chat"].includes(heuristicIntent.intent)) {
        intent = llmIntent;
      }
    }
    if (!intent.entities.taskTitle && heuristicIntent.entities.taskTitle) {
      intent.entities.taskTitle = heuristicIntent.entities.taskTitle;
    }
    if (!intent.entities.taskNumber && heuristicIntent.entities.taskNumber) {
      intent.entities.taskNumber = heuristicIntent.entities.taskNumber;
    }
    if (!intent.entities.customerNumber && heuristicIntent.entities.customerNumber) {
      intent.entities.customerNumber = heuristicIntent.entities.customerNumber;
    }
    if (!intent.entities.saleNumber && heuristicIntent.entities.saleNumber) {
      intent.entities.saleNumber = heuristicIntent.entities.saleNumber;
    }
    if (!intent.entities.customerName && heuristicIntent.entities.customerName) {
      intent.entities.customerName = heuristicIntent.entities.customerName;
    }
    if (!intent.entities.customerEmail && heuristicIntent.entities.customerEmail) {
      intent.entities.customerEmail = heuristicIntent.entities.customerEmail;
    }
    if (!intent.entities.customerPhone && heuristicIntent.entities.customerPhone) {
      intent.entities.customerPhone = heuristicIntent.entities.customerPhone;
    }
    if (!intent.entities.customerAddress && heuristicIntent.entities.customerAddress) {
      intent.entities.customerAddress = heuristicIntent.entities.customerAddress;
    }
  } catch (error) {
    logger.warn("agent_llm_intent_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.debug("agent_input", { rawText });
  logger.debug("agent_interpretation", {
    intent: intent.intent,
    confidence: intent.confidence,
    entities: intent.entities,
  });
  if (intent.intent === "normal_chat" || intent.intent === "chat") {
    return { handled: false };
  }

  const plan = buildPlan(intent);
  const performedBy = params.performedBy === "ai" ? "ai" : "user";
  plan.steps = plan.steps.map((step) => ({
    ...step,
    data: { ...(step.data || {}), _performedBy: performedBy },
  }));
  if (intent.intent === "create_task" && plan.steps[0]) {
    plan.steps[0].data = {
      ...(plan.steps[0].data || {}),
      title: intent.entities.taskTitle || rawText,
      raw_input: rawText,
      parsed_input: { intent: intent.intent, entities: intent.entities },
      meta: { ai_interpretation: intent.entities, raw_text: rawText },
    };
  }
  if (intent.intent === "create_customer" && plan.steps[0]) {
    plan.steps[0].data = {
      ...(plan.steps[0].data || {}),
      name: intent.entities.customerName || rawText,
      raw_input: rawText,
      parsed_input: { intent: intent.intent, entities: intent.entities },
    };
  }
  if (intent.intent === "create_sale" && plan.steps[0]) {
    plan.steps[0].data = {
      ...(plan.steps[0].data || {}),
      raw_input: rawText,
      parsed_input: { intent: intent.intent, entities: intent.entities },
    };
  }
  if (intent.intent === "update_task" && plan.steps[0]) {
    const updates = intent.entities.updates || {};
    const mappedUpdates: Record<string, unknown> = { ...updates };
    if ((updates as any).due_date || (updates as any).dueDate) {
      mappedUpdates.dueDate = (updates as any).due_date || (updates as any).dueDate;
      delete mappedUpdates.due_date;
    }
    if ((updates as any).assigned_to || (updates as any).assignedTo) {
      mappedUpdates.assignedTo = (updates as any).assigned_to || (updates as any).assignedTo;
      delete mappedUpdates.assigned_to;
    }
    if ((updates as any).assignee_name || (updates as any).assigneeName || (updates as any).assigned_user) {
      mappedUpdates.assigneeName =
        (updates as any).assignee_name || (updates as any).assigneeName || (updates as any).assigned_user;
      delete (mappedUpdates as any).assignee_name;
      delete (mappedUpdates as any).assigned_user;
    }
    plan.steps[0].data = {
      ...(plan.steps[0].data || {}),
      ...(mappedUpdates || {}),
    };
  }
  if (intent.intent === "update_customer" && plan.steps[0]) {
    const updates = intent.entities.updates || {};
    const mappedUpdates: Record<string, unknown> = { ...updates };
    if ((updates as any).phone_number || (updates as any).phoneNumber) {
      mappedUpdates.phone = (updates as any).phone_number || (updates as any).phoneNumber;
      delete (mappedUpdates as any).phone_number;
    }
    if ((updates as any).email_address || (updates as any).emailAddress) {
      mappedUpdates.email = (updates as any).email_address || (updates as any).emailAddress;
      delete (mappedUpdates as any).email_address;
    }
    if ((updates as any).full_name || (updates as any).fullName) {
      mappedUpdates.name = (updates as any).full_name || (updates as any).fullName;
      delete (mappedUpdates as any).full_name;
    }
    if ((updates as any).address_line || (updates as any).addressLine) {
      mappedUpdates.address = (updates as any).address_line || (updates as any).addressLine;
      delete (mappedUpdates as any).address_line;
    }
    if (!Object.keys(mappedUpdates).length) {
      if (intent.entities.customerName) mappedUpdates.name = intent.entities.customerName;
      if (intent.entities.customerEmail) mappedUpdates.email = intent.entities.customerEmail;
      if (intent.entities.customerPhone) mappedUpdates.phone = intent.entities.customerPhone;
      if (intent.entities.customerAddress) mappedUpdates.address = intent.entities.customerAddress;
    }
    plan.steps[0].data = {
      ...(plan.steps[0].data || {}),
      ...(mappedUpdates || {}),
    };
  }
  if (intent.intent === "update_sale" && plan.steps[0]) {
    const updates = intent.entities.updates || {};
    const mappedUpdates: Record<string, unknown> = { ...updates };
    if ((updates as any).customer_number || (updates as any).customerNumber) {
      mappedUpdates.customerNumber = (updates as any).customer_number || (updates as any).customerNumber;
      delete (mappedUpdates as any).customer_number;
    }
    if ((updates as any).assigned_to || (updates as any).assignee_id) {
      mappedUpdates.assignedTo = (updates as any).assigned_to || (updates as any).assignee_id;
      delete (mappedUpdates as any).assigned_to;
    }
    if ((updates as any).assignee_name || (updates as any).assigneeName || (updates as any).assigned_user) {
      mappedUpdates.assigneeName =
        (updates as any).assignee_name || (updates as any).assigneeName || (updates as any).assigned_user;
      delete (mappedUpdates as any).assignee_name;
      delete (mappedUpdates as any).assigned_user;
    }
    if ((updates as any).payment_method || (updates as any).paymentMethod) {
      mappedUpdates.paymentMethod = (updates as any).payment_method || (updates as any).paymentMethod;
      delete (mappedUpdates as any).payment_method;
    }
    if ((updates as any).sale_status || (updates as any).saleStatus) {
      mappedUpdates.status = (updates as any).sale_status || (updates as any).saleStatus;
      delete (mappedUpdates as any).sale_status;
    }
    plan.steps[0].data = {
      ...(plan.steps[0].data || {}),
      ...(mappedUpdates || {}),
    };
  }
  const reasoning = evaluatePlan(intent, plan);
  if (reasoning.needsClarification) {
    return {
      handled: true,
      answer: reasoning.clarificationQuestion || "Can you clarify your request?",
      businessData: null,
    };
  }

  const governance = await evaluateGovernance(intent, plan, context);
  if (!governance.allowed) {
    return {
      handled: true,
      answer: governance.message || "I cannot execute that action.",
      businessData: null,
    };
  }

  if (governance.requiresConfirmation) {
    await savePendingConfirmation(context, { intent, plan });
    return {
      handled: true,
      answer: governance.message || "Please confirm to proceed.",
      businessData: { riskLevel: governance.riskLevel },
    };
  }

  if (!context.userId) {
    return { handled: true, answer: "User context required.", businessData: null };
  }

  const execution = await runManagerAgent(intent, plan, context);
  if (!execution.success) {
    return {
      handled: true,
      answer: `Action failed: ${execution.error}`,
      businessData: { execution },
    };
  }

  const summary = summarizeExecution(intent, execution.results);
  const management = await buildManagementInsights(context.userId);
  await runEventTriggers(context.userId);

  const evidence = [
    `intent=${intent.intent}`,
    `confidence=${intent.confidence.toFixed(2)}`,
    `risk=${governance.riskLevel}`,
  ];
  if (intent.intent === "list_tasks") {
    const tasks = (execution.results[0]?.output?.tasks as any[]) || [];
    const preview = tasks.slice(0, 10).map((task) => {
      const label = task?.title ? `"${task.title}"` : "(untitled)";
      return `#${task?.taskNumber || task?.task_number || "?"} ${label} [${task?.status || "todo"} | ${task?.priority || "medium"}]`;
    });
    if (preview.length) {
      evidence.push(`tasks_preview=${JSON.stringify(preview)}`);
    }
  }
  if (intent.intent === "list_customers") {
    const customers = (execution.results[0]?.output?.customers as any[]) || [];
    const preview = customers.slice(0, 10).map((customer) => {
      const label = customer?.name ? `"${customer.name}"` : "(unnamed)";
      return `${customer?.customerNumber ?? customer?.customer_number ?? "?"} ${label}`;
    });
    if (preview.length) {
      evidence.push(`customers_preview=${JSON.stringify(preview)}`);
    }
  }
  if (intent.intent === "list_sales") {
    const sales = (execution.results[0]?.output?.sales as any[]) || [];
    const preview = sales.slice(0, 10).map((sale) => {
      return `${sale?.saleNumber ?? sale?.sale_number ?? "?"} ${sale?.status || "unknown"}`;
    });
    if (preview.length) {
      evidence.push(`sales_preview=${JSON.stringify(preview)}`);
    }
  }

  return {
    handled: true,
    answer: makeStructuredAnswer(
      summary,
      evidence,
      management.insights.length ? management.insights : ["Keep tracking task progress and KPIs."]
    ),
    businessData: {
      execution,
      management,
    },
  };
};

/*
Agent Architecture Diagram

PERCEIVE -> INTENT -> PLAN -> GOVERN -> EXECUTE -> REFLECT -> MEMORY
   |                                   |
   +--------------> EVENT TRIGGERS <---+

Examples:
User: "Create task follow up with Acme tomorrow"
Agent: Answer: Created task "follow up with Acme".
Evidence:
- intent=create_task
- confidence=0.85
Next steps:
- Review the due date set to 2026-02-10.

User: "Delete task 65ad..."
Agent: This action is destructive. Please confirm to proceed.
*/
