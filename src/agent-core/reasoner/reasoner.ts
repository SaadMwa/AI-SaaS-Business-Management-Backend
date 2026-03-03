import { IntentResult, Plan } from "../types";

export type ReasonerResult = {
  needsClarification: boolean;
  clarificationQuestion?: string;
};

export const evaluatePlan = (intent: IntentResult, plan: Plan): ReasonerResult => {
  if (intent.intent === "create_task" && !intent.entities.taskTitle) {
    return {
      needsClarification: true,
      clarificationQuestion: "What is the task title you want me to create?",
    };
  }

  if (
    ["delete_task", "assign_task", "negotiate_deadline", "change_status", "change_priority"].includes(
      intent.intent
    ) &&
    !intent.entities.taskNumber
  ) {
    return {
      needsClarification: true,
      clarificationQuestion: "Which task number should I use? Please provide the task number.",
    };
  }

  if (intent.intent === "update_task" && !intent.entities.taskNumber) {
    return {
      needsClarification: true,
      clarificationQuestion: "Which task number should I update?",
    };
  }

  if (intent.intent === "assign_task" && !intent.entities.assigneeEmail && !intent.entities.assigneeId && !intent.entities.assigneeName) {
    return {
      needsClarification: true,
      clarificationQuestion: "Who should I assign this task to? Provide a name or email.",
    };
  }

  if ((intent.intent === "change_priority" || intent.intent === "reprioritize_tasks") && !intent.entities.priority) {
    return {
      needsClarification: true,
      clarificationQuestion: "What priority should I apply (low, medium, high, urgent)?",
    };
  }

  if (intent.intent === "change_status" && !intent.entities.status) {
    return {
      needsClarification: true,
      clarificationQuestion: "What status should I set (todo, in_progress, blocked, done)?",
    };
  }

  if (intent.intent === "change_sale_status" && !intent.entities.saleStatus) {
    return {
      needsClarification: true,
      clarificationQuestion: "What sale status should I set (draft, pending, paid, cancelled, refunded)?",
    };
  }

  if (
    ["update_customer", "delete_customer", "view_customer"].includes(intent.intent) &&
    !intent.entities.customerNumber
  ) {
    return {
      needsClarification: true,
      clarificationQuestion: "Which customer number should I use? Please provide the numeric customer number (e.g., 12).",
    };
  }

  if (intent.intent === "create_customer" && !intent.entities.customerName) {
    return {
      needsClarification: true,
      clarificationQuestion: "What is the customer name you want me to create?",
    };
  }

  if (
    ["update_sale", "delete_sale", "view_sale", "assign_sale", "change_sale_status"].includes(
      intent.intent
    ) &&
    !intent.entities.saleNumber
  ) {
    return {
      needsClarification: true,
      clarificationQuestion: "Which sale number should I use? Please provide the numeric sale number (e.g., 7).",
    };
  }

  if (intent.intent === "schedule_plan" && !plan.steps[0]?.data) {
    return {
      needsClarification: true,
      clarificationQuestion: "What tasks should I schedule? Provide task titles and due dates.",
    };
  }

  if (intent.intent === "negotiate_deadline" && !intent.entities.dueDate) {
    return {
      needsClarification: true,
      clarificationQuestion: "What new due date should I set (YYYY-MM-DD)?",
    };
  }

  if (plan.steps.length === 0) {
    return {
      needsClarification: true,
      clarificationQuestion: "Can you clarify what outcome you want?",
    };
  }

  return { needsClarification: false };
};
