export type IntentType =
  | "create_task"
  | "update_task"
  | "delete_task"
  | "assign_task"
  | "change_status"
  | "change_priority"
  | "list_tasks"
  | "chat"
  | "create_customer"
  | "update_customer"
  | "delete_customer"
  | "view_customer"
  | "list_customers"
  | "create_sale"
  | "update_sale"
  | "delete_sale"
  | "view_sale"
  | "assign_sale"
  | "change_sale_status"
  | "list_sales"
  | "reprioritize_tasks"
  | "optimize_workload"
  | "schedule_plan"
  | "generate_report"
  | "analyze_productivity"
  | "detect_risk"
  | "automate_workflow"
  | "negotiate_deadline"
  | "strategic_planning"
  | "normal_chat";

export type PlanAction =
  | "create_task"
  | "update_task"
  | "delete_task"
  | "assign_task"
  | "change_status"
  | "change_priority"
  | "list_tasks"
  | "chat"
  | "create_customer"
  | "update_customer"
  | "delete_customer"
  | "view_customer"
  | "list_customers"
  | "create_sale"
  | "update_sale"
  | "delete_sale"
  | "view_sale"
  | "assign_sale"
  | "change_sale_status"
  | "list_sales"
  | "reprioritize_tasks"
  | "optimize_workload"
  | "schedule_plan"
  | "generate_report"
  | "analyze_productivity"
  | "detect_risk"
  | "automate_workflow"
  | "negotiate_deadline"
  | "strategic_planning"
  | "normal_chat";

export type RiskLevel = "low" | "medium" | "high";

export type AgentEntity = {
  taskId?: string;
  taskNumber?: number;
  taskTitle?: string;
  customerNumber?: number;
  saleNumber?: number;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAddress?: string;
  saleItems?: { name: string; quantity: number; price: number }[];
  saleStatus?: "draft" | "pending" | "paid" | "cancelled" | "refunded";
  assigneeEmail?: string;
  assigneeId?: string;
  assigneeName?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  status?: "todo" | "in_progress" | "in-progress" | "done" | "blocked";
  dueDate?: string;
  timeframe?: "today" | "tomorrow" | "next_week" | "next_month" | "this_week" | "this_month";
  confirmation?: boolean;
  updates?: Record<string, unknown>;
};

export type IntentResult = {
  intent: IntentType;
  confidence: number;
  entities: AgentEntity;
  rationale: string[];
};

export type PlanStep = {
  action: PlanAction;
  data?: Record<string, unknown>;
  description?: string;
};

export type Plan = {
  goal: string;
  strategy: string;
  steps: PlanStep[];
};

export type AgentContext = {
  userId?: string;
  sessionId?: string;
  role?: "user" | "admin" | "moderator";
  requestId?: string;
};
