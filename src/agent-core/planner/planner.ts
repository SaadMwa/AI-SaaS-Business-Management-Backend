import { IntentResult, Plan } from "../types";

export const buildPlan = (intent: IntentResult): Plan => {
  switch (intent.intent) {
    case "create_task":
      return {
        goal: "Create a new task",
        strategy: "Create and assign task with provided details",
        steps: [
          {
            action: "create_task",
            data: {
              title: intent.entities.taskTitle,
              priority: intent.entities.priority,
              dueDate: intent.entities.dueDate,
              assigneeEmail: intent.entities.assigneeEmail,
              assigneeName: intent.entities.assigneeName,
            },
            description: "Create task with extracted fields",
          },
        ],
      };
    case "update_task":
      return {
        goal: "Update an existing task",
        strategy: "Apply user-requested updates",
        steps: [
          {
            action: "update_task",
            data: {
              taskNumber: intent.entities.taskNumber,
              title: intent.entities.taskTitle,
              status: intent.entities.status,
              priority: intent.entities.priority,
              dueDate: intent.entities.dueDate,
            },
            description: "Update task with matching fields",
          },
        ],
      };
    case "delete_task":
      return {
        goal: "Delete a task",
        strategy: "Validate request then delete task",
        steps: [{ action: "delete_task", data: { taskNumber: intent.entities.taskNumber } }],
      };
    case "assign_task":
      return {
        goal: "Assign a task",
        strategy: "Update task assignee",
        steps: [
          {
            action: "assign_task",
            data: {
              taskNumber: intent.entities.taskNumber,
              assigneeEmail: intent.entities.assigneeEmail,
              assigneeName: intent.entities.assigneeName,
            },
          },
        ],
      };
    case "change_status":
      return {
        goal: "Change task status",
        strategy: "Update task status",
        steps: [
          {
            action: "change_status",
            data: {
              taskNumber: intent.entities.taskNumber,
              status: intent.entities.status,
            },
          },
        ],
      };
    case "change_priority":
      return {
        goal: "Change task priority",
        strategy: "Update task priority",
        steps: [
          {
            action: "change_priority",
            data: {
              taskNumber: intent.entities.taskNumber,
              priority: intent.entities.priority,
            },
          },
        ],
      };
    case "list_tasks":
      return {
        goal: "List tasks",
        strategy: "Fetch tasks and summarize",
        steps: [{ action: "list_tasks" }],
      };
    case "create_customer":
      return {
        goal: "Create a customer",
        strategy: "Create customer with provided details",
        steps: [
          {
            action: "create_customer",
            data: {
              name: intent.entities.customerName,
              email: intent.entities.customerEmail,
              phone: intent.entities.customerPhone,
              address: intent.entities.customerAddress,
            },
          },
        ],
      };
    case "update_customer":
      return {
        goal: "Update a customer",
        strategy: "Apply customer updates",
        steps: [
          {
            action: "update_customer",
            data: {
              customerNumber: intent.entities.customerNumber,
              name: intent.entities.customerName,
              email: intent.entities.customerEmail,
              phone: intent.entities.customerPhone,
              address: intent.entities.customerAddress,
            },
          },
        ],
      };
    case "delete_customer":
      return {
        goal: "Delete a customer",
        strategy: "Validate request then delete customer",
        steps: [{ action: "delete_customer", data: { customerNumber: intent.entities.customerNumber } }],
      };
    case "view_customer":
      return {
        goal: "View a customer",
        strategy: "Fetch customer details",
        steps: [{ action: "view_customer", data: { customerNumber: intent.entities.customerNumber } }],
      };
    case "list_customers":
      return {
        goal: "List customers",
        strategy: "Fetch customers and summarize",
        steps: [{ action: "list_customers" }],
      };
    case "create_sale":
      return {
        goal: "Create a sale",
        strategy: "Create sale with provided details",
        steps: [
          {
            action: "create_sale",
            data: {
              customerNumber: intent.entities.customerNumber,
              status: intent.entities.saleStatus,
            },
          },
        ],
      };
    case "update_sale":
      return {
        goal: "Update a sale",
        strategy: "Apply sale updates",
        steps: [
          {
            action: "update_sale",
            data: {
              saleNumber: intent.entities.saleNumber,
              status: intent.entities.saleStatus,
            },
          },
        ],
      };
    case "delete_sale":
      return {
        goal: "Delete a sale",
        strategy: "Validate request then delete sale",
        steps: [{ action: "delete_sale", data: { saleNumber: intent.entities.saleNumber } }],
      };
    case "view_sale":
      return {
        goal: "View a sale",
        strategy: "Fetch sale details",
        steps: [{ action: "view_sale", data: { saleNumber: intent.entities.saleNumber } }],
      };
    case "assign_sale":
      return {
        goal: "Assign a sale",
        strategy: "Update sale assignee",
        steps: [
          {
            action: "assign_sale",
            data: {
              saleNumber: intent.entities.saleNumber,
              assigneeEmail: intent.entities.assigneeEmail,
              assigneeId: intent.entities.assigneeId,
              assigneeName: intent.entities.assigneeName,
            },
          },
        ],
      };
    case "change_sale_status":
      return {
        goal: "Change sale status",
        strategy: "Update sale status",
        steps: [
          {
            action: "change_sale_status",
            data: {
              saleNumber: intent.entities.saleNumber,
              status: intent.entities.saleStatus,
            },
          },
        ],
      };
    case "list_sales":
      return {
        goal: "List sales",
        strategy: "Fetch sales and summarize",
        steps: [{ action: "list_sales" }],
      };
    case "reprioritize_tasks":
      return {
        goal: "Reprioritize tasks",
        strategy: "Adjust task priorities based on request",
        steps: [
          {
            action: "reprioritize_tasks",
            data: {
              priority: intent.entities.priority,
            },
          },
        ],
      };
    case "optimize_workload":
      return {
        goal: "Optimize workload",
        strategy: "Analyze workload and propose balancing",
        steps: [{ action: "optimize_workload" }],
      };
    case "schedule_plan":
      return {
        goal: "Schedule a plan",
        strategy: "Create a schedule from provided tasks",
        steps: [{ action: "schedule_plan" }],
      };
    case "generate_report":
      return {
        goal: "Generate a management report",
        strategy: "Compile KPIs and task metrics",
        steps: [{ action: "generate_report" }],
      };
    case "analyze_productivity":
      return {
        goal: "Analyze productivity",
        strategy: "Compute productivity metrics and insights",
        steps: [{ action: "analyze_productivity" }],
      };
    case "detect_risk":
      return {
        goal: "Detect operational risks",
        strategy: "Identify overdue tasks and revenue risks",
        steps: [{ action: "detect_risk" }],
      };
    case "automate_workflow":
      return {
        goal: "Automate workflow",
        strategy: "Apply automation to tasks",
        steps: [{ action: "automate_workflow" }],
      };
    case "negotiate_deadline":
      return {
        goal: "Adjust deadlines",
        strategy: "Update due dates",
        steps: [
          {
            action: "negotiate_deadline",
            data: { taskNumber: intent.entities.taskNumber, dueDate: intent.entities.dueDate },
          },
        ],
      };
    case "strategic_planning":
      return {
        goal: "Strategic planning",
        strategy: "Analyze current state and propose strategy",
        steps: [{ action: "strategic_planning" }, { action: "generate_report" }],
      };
    default:
      return {
        goal: "Respond to user",
        strategy: "Answer conversationally",
        steps: [{ action: "chat" }],
      };
  }
};
