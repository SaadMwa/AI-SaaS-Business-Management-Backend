import { PlanAction } from "../types";
import { taskService } from "../../services/task.service";
import { customerService } from "../../services/customer.service";
import { saleService } from "../../services/sale.service";
import { generateInsights, getDashboardMetrics } from "../../services/analytics.service";

export type ToolResult = {
  action: PlanAction;
  output: Record<string, unknown>;
};

export const toolRegistry = {
  execute: async (action: PlanAction, userId: string, data?: Record<string, unknown>) => {
    switch (action) {
      case "create_task":
        return { action, output: { task: await taskService.createTask(userId, data || {}) } };
      case "update_task":
        return {
          action,
          output: data?.taskNumber
            ? {
                task: await taskService.updateTaskByNumber(
                  userId,
                  data?.taskNumber as number,
                  data || {}
                ),
              }
            : {
                task: await taskService.updateTask(
                  userId,
                  data?.taskId as string | undefined,
                  data || {}
                ),
              },
        };
      case "delete_task":
        return {
          action,
          output: data?.taskNumber
            ? {
                task: await taskService.deleteTaskByNumber(
                  userId,
                  data?.taskNumber as number,
                  (data?._performedBy as "user" | "ai") || "user"
                ),
              }
            : { task: await taskService.deleteTask(userId, data?.taskId as string) },
        };
      case "assign_task":
        return {
          action,
          output: {
            task: data?.taskNumber
              ? await taskService.assignTaskByNumber(
                  userId,
                  data?.taskNumber as number,
                  data?.assigneeEmail as string,
                  data?.assigneeId as string,
                  data?.assigneeName as string,
                  (data?._performedBy as "user" | "ai") || "user"
                )
              : await taskService.assignTask(
                  userId,
                  data?.taskId as string,
                  data?.assigneeEmail as string,
                  data?.assigneeId as string,
                  data?.assigneeName as string
                ),
          },
        };
      case "change_status":
        return {
          action,
          output: {
            task: await taskService.updateTaskByNumber(userId, data?.taskNumber as number, {
              status: data?.status,
            }),
          },
        };
      case "change_priority":
        return {
          action,
          output: {
            task: await taskService.updateTaskByNumber(userId, data?.taskNumber as number, {
              priority: data?.priority,
            }),
          },
        };
      case "list_tasks":
        return {
          action,
          output: {
            tasks: await taskService.listTasks(userId),
          },
        };
      case "create_customer":
        return { action, output: { customer: await customerService.createCustomer(userId, data || {}) } };
      case "update_customer":
        return {
          action,
          output: {
            customer: await customerService.updateCustomerByNumber(
              userId,
              data?.customerNumber as number,
              data || {}
            ),
          },
        };
      case "delete_customer":
        return {
          action,
          output: {
            customer: await customerService.deleteCustomerByNumber(
              userId,
              data?.customerNumber as number,
              (data?._performedBy as "user" | "ai") || "user"
            ),
          },
        };
      case "view_customer":
        return {
          action,
          output: {
            customer: await customerService.getCustomerByNumber(
              userId,
              data?.customerNumber as number
            ),
          },
        };
      case "list_customers":
        return {
          action,
          output: {
            customers: await customerService.listCustomers(userId),
          },
        };
      case "create_sale":
        return {
          action,
          output: {
            sale: await saleService.createSale(userId, data || {}),
          },
        };
      case "update_sale":
        return {
          action,
          output: {
            sale: await saleService.updateSaleByNumber(
              userId,
              data?.saleNumber as number,
              data || {}
            ),
          },
        };
      case "delete_sale":
        return {
          action,
          output: {
            sale: await saleService.deleteSaleByNumber(
              userId,
              data?.saleNumber as number,
              (data?._performedBy as "user" | "ai") || "user"
            ),
          },
        };
      case "view_sale":
        return {
          action,
          output: {
            sale: await saleService.getSaleByNumber(userId, data?.saleNumber as number),
          },
        };
      case "assign_sale":
        return {
          action,
          output: {
            sale: await saleService.assignSaleByNumber(
              userId,
              data?.saleNumber as number,
              data?.assigneeEmail as string,
              data?.assigneeId as string,
              data?.assigneeName as string,
              (data?._performedBy as "user" | "ai") || "user"
            ),
          },
        };
      case "change_sale_status":
        return {
          action,
          output: {
            sale: await saleService.updateSaleByNumber(userId, data?.saleNumber as number, {
              status: data?.status,
            }),
          },
        };
      case "list_sales":
        return {
          action,
          output: {
            sales: await saleService.listSales(userId, { createdBy: userId }),
          },
        };
      case "reprioritize_tasks":
        return {
          action,
          output: { result: await taskService.reprioritizeTasks(userId, data?.priority as string) },
        };
      case "optimize_workload":
        return { action, output: { result: await taskService.optimizeWorkload(userId) } };
      case "schedule_plan":
        return {
          action,
          output: {
            tasks: await taskService.schedulePlan(userId, (data?.tasks || []) as any),
          },
        };
      case "generate_report":
        return {
          action,
          output: {
            metrics: await getDashboardMetrics(userId),
            insights: await generateInsights(userId),
          },
        };
      case "analyze_productivity":
        return {
          action,
          output: { metrics: await getDashboardMetrics(userId) },
        };
      case "detect_risk":
        return {
          action,
          output: { insights: await generateInsights(userId) },
        };
      case "automate_workflow":
        return {
          action,
          output: { autoTag: await taskService.autoTagTasks(userId) },
        };
      case "negotiate_deadline":
        return {
          action,
          output: data?.taskNumber
            ? {
                task: await taskService.updateTaskByNumber(userId, data?.taskNumber as number, {
                  dueDate: data?.dueDate as string,
                }),
              }
            : {
                task: await taskService.negotiateDeadline(
                  userId,
                  data?.taskId as string,
                  data?.dueDate as string
                ),
              },
        };
      case "strategic_planning":
        return {
          action,
          output: {
            metrics: await getDashboardMetrics(userId),
            insights: await generateInsights(userId),
          },
        };
      case "chat":
      case "normal_chat":
      default:
        return { action, output: { message: "handled_by_ai" } };
    }
  },

  rollback: async (action: PlanAction, userId: string, output: Record<string, unknown>) => {
    const createdTask = output.task as { _id?: string | { toString: () => string } } | undefined;
    if (action === "create_task" && createdTask?._id) {
      await taskService.deleteTask(userId, createdTask._id.toString());
    }
  },
};
