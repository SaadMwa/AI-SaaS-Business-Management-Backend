import { taskService } from "./task.service";
import { customerService } from "./customer.service";
import { saleService } from "./sale.service";

export type EntityType = "task" | "customer" | "sale";

export const entityService = {
  updateEntity: async (
    userId: string,
    entityType: EntityType,
    entityNumber: number,
    updatedFields: Record<string, unknown>
  ) => {
    switch (entityType) {
      case "task":
        return taskService.updateTaskFlexibleByNumber(userId, entityNumber, updatedFields);
      case "customer":
        return customerService.updateCustomerFlexibleByNumber(userId, entityNumber, updatedFields);
      case "sale":
        return saleService.updateSaleFlexibleByNumber(userId, entityNumber, updatedFields);
      default:
        throw new Error("Unsupported entity type");
    }
  },
};
