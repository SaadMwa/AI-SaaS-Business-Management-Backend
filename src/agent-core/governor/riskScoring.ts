import { PlanAction, RiskLevel } from "../types";

export const scoreRisk = (action: PlanAction): RiskLevel => {
  if (
    ["delete_task", "automate_workflow", "reprioritize_tasks", "delete_customer", "delete_sale"].includes(
      action
    )
  )
    return "high";
  if (
    [
      "update_task",
      "assign_task",
      "negotiate_deadline",
      "change_status",
      "change_priority",
      "update_customer",
      "update_sale",
      "assign_sale",
      "change_sale_status",
    ].includes(action)
  )
    return "medium";
  return "low";
};
