import mongoose from "mongoose";
import { Sale } from "../models/sale";
import { Customer } from "../models/customer";
import { User } from "../models/user";
import { getNextSequence } from "./counter.service";
import { historyService } from "./history.service";

const STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ["pending", "cancelled"],
  pending: ["paid", "cancelled"],
  paid: ["refunded"],
  cancelled: [],
  refunded: [],
};

const validateItems = (items: unknown) => {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, message: "At least one item is required" } as const;
  }

  for (const item of items) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof (item as { name?: string }).name !== "string" ||
      !(item as { name: string }).name.trim()
    ) {
      return { ok: false, message: "Each item must have a name" } as const;
    }

    const quantity = Number((item as { quantity?: number }).quantity);
    const price = Number((item as { price?: number }).price);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, message: "Each item must have a valid quantity" } as const;
    }
    if (!Number.isFinite(price) || price < 0) {
      return { ok: false, message: "Each item must have a valid price" } as const;
    }
  }

  return { ok: true } as const;
};

const calculateTotal = (items: { quantity: number; price: number }[]) => {
  return items.reduce((sum, item) => sum + item.quantity * item.price, 0);
};

const canTransition = (from: string, to: string) => {
  if (from === to) return true;
  return (STATUS_TRANSITIONS[from] || []).includes(to);
};

const parseSaleNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/\d+/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const getMaxSaleNumber = async (userId: string) => {
  const result = await Sale.aggregate([
    { $match: { createdBy: new mongoose.Types.ObjectId(userId) } },
    {
      $addFields: {
        normalized: {
          $ifNull: [
            "$saleNumber",
            {
              $let: {
                vars: {
                  matchObj: { $regexFind: { input: "$sale_number", regex: /\d+/ } },
                },
                in: {
                  $toInt: { $ifNull: ["$$matchObj.match", "0"] },
                },
              },
            },
          ],
        },
      },
    },
    { $sort: { normalized: -1 } },
    { $limit: 1 },
    { $project: { normalized: 1 } },
  ]);
  return result[0]?.normalized || 0;
};

const getNextSaleNumber = async (userId: string) => {
  return getNextSequence(userId, "sale", () => getMaxSaleNumber(userId));
};

const ensureSaleNumbers = async (userId: string, sales: any[]) => {
  const missing = sales.filter((sale) => !sale.saleNumber);
  if (!missing.length) return sales;

  for (const sale of missing) {
    const parsedLegacy = parseSaleNumber(sale.sale_number);
    if (parsedLegacy) {
      sale.saleNumber = parsedLegacy;
      await Sale.updateOne({ _id: sale._id }, { $set: { saleNumber: parsedLegacy } });
      continue;
    }
    const next = await getNextSaleNumber(userId);
    sale.saleNumber = next;
    await Sale.updateOne(
      { _id: sale._id },
      { $set: { saleNumber: next, sale_number: String(next) } }
    );
  }

  return sales.sort((a, b) => (a.saleNumber || 0) - (b.saleNumber || 0));
};

const findUserByEmail = async (email?: string) => {
  if (!email || typeof email !== "string") return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return User.findOne({ email: { $regex: `^${escaped}$`, $options: "i" } })
    .select("_id")
    .lean();
};

const getPerformedBy = (payload?: Record<string, unknown>) => {
  const value = payload?.performedBy || payload?._performedBy;
  return value === "ai" ? "ai" : "user";
};

const findUserByName = async (name?: string) => {
  if (!name || typeof name !== "string") return null;
  const normalized = name.trim();
  if (!normalized) return null;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return User.findOne({ name: { $regex: `^${escaped}$`, $options: "i" } })
    .select("_id")
    .lean();
};

const resolveAssignee = async (params: {
  assigneeEmail?: string;
  assigneeId?: string;
  assigneeName?: string;
}) => {
  if (params.assigneeId) {
    const user = await User.findById(params.assigneeId).select("_id").lean();
    if (!user) throw new Error("Assignee not found");
    return user._id.toString();
  }
  if (params.assigneeEmail) {
    const user = await findUserByEmail(params.assigneeEmail);
    if (!user) throw new Error("Assignee not found");
    return user._id.toString();
  }
  if (params.assigneeName) {
    const user = await findUserByName(params.assigneeName);
    if (!user) throw new Error("Assignee not found");
    return user._id.toString();
  }
  return undefined;
};

export const saleService = {
  listSales: async (userId: string, query: Record<string, unknown>) => {
    const sales = await Sale.find(query)
      .populate("customerId", "name email customerNumber customer_number")
      .populate("assignedTo", "name email")
      .sort({ saleNumber: 1, date: -1 });
    return ensureSaleNumbers(userId, sales as any[]);
  },

  getSaleByNumber: async (userId: string, saleNumber: number) => {
    const sale = await Sale.findOne({
      createdBy: userId,
      $or: [{ saleNumber }, { sale_number: String(saleNumber) }],
    })
      .populate("customerId", "name email customerNumber customer_number")
      .populate("assignedTo", "name email");
    if (!sale) throw new Error("Sale not found");
    if (!sale.saleNumber) {
      const parsedLegacy = parseSaleNumber(sale.sale_number);
      if (parsedLegacy) {
        sale.saleNumber = parsedLegacy;
        await sale.save();
      }
    }
    return sale;
  },

  createSale: async (userId: string, data: Record<string, unknown>) => {
    let { customerId, items, status, date, paymentMethod } = data;
    const customerNumber = data.customerNumber as number | string | undefined;

    if (!customerId && customerNumber) {
      const parsedCustomerNumber = parseSaleNumber(customerNumber);
      const customerByNumber = await Customer.findOne({
        createdBy: userId,
        $or: [
          { customerNumber: parsedCustomerNumber },
          { customer_number: String(parsedCustomerNumber ?? customerNumber) },
        ],
      }).select("_id");
      if (!customerByNumber) throw new Error("Customer not found");
      customerId = customerByNumber._id.toString();
    }

    if (!customerId) throw new Error("customerId is required");
    const customer = await Customer.findOne({ _id: customerId, createdBy: userId });
    if (!customer) throw new Error("Customer not found");

    const itemsValidation = validateItems(items);
    if (!itemsValidation.ok) throw new Error(itemsValidation.message);

    const total = calculateTotal(items as { quantity: number; price: number }[]);

    let sale;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const saleNumber = await getNextSaleNumber(userId);
        sale = await Sale.create({
          saleNumber,
          sale_number: String(saleNumber),
          customerId,
          items,
          total,
          status: status || "draft",
          date: date ? new Date(date as string) : new Date(),
          paymentMethod: paymentMethod || "other",
          createdBy: new mongoose.Types.ObjectId(userId),
          raw_input: data.raw_input,
          parsed_input: data.parsed_input || {},
        });
        break;
      } catch (error: any) {
        if (error?.code === 11000 && attempt < 2) continue;
        throw error;
      }
    }

    if (!sale) throw new Error("Failed to create sale");
    await sale.populate("customerId", "name email customerNumber customer_number");
    await sale.populate("assignedTo", "name email");

    await historyService.logAction({
      userId,
      entityType: "sale",
      entityNumber: sale.saleNumber,
      action: "create",
      performedBy: getPerformedBy(data),
      meta: { total: sale.total, status: sale.status },
    });
    return sale;
  },

  updateSaleFlexibleByNumber: async (
    userId: string,
    saleNumber: number,
    data: Record<string, unknown>
  ) => {
    const sale = await Sale.findOne({
      createdBy: userId,
      $or: [{ saleNumber }, { sale_number: String(saleNumber) }],
    });
    if (!sale) throw new Error("Sale not found");

    const handledKeys = new Set<string>();
    if (data.items) {
      const itemsValidation = validateItems(data.items);
      if (!itemsValidation.ok) throw new Error(itemsValidation.message);
      sale.items = data.items as any;
      sale.total = calculateTotal(data.items as { quantity: number; price: number }[]);
      handledKeys.add("items");
      handledKeys.add("total");
    }

    if (data.status) {
      if (!canTransition(sale.status, data.status as string)) {
        throw new Error(`Invalid status transition from ${sale.status} to ${data.status}`);
      }
      sale.status = data.status as any;
      handledKeys.add("status");
    }

    if (typeof data.date !== "undefined") {
      sale.date = data.date ? new Date(data.date as string) : new Date();
      handledKeys.add("date");
    }
    if (data.paymentMethod) sale.paymentMethod = data.paymentMethod as any;
    if (data.paymentMethod) handledKeys.add("paymentMethod");
    if (data.customerId) sale.customerId = data.customerId as any;
    if (data.customerId) handledKeys.add("customerId");
    if (data.customerNumber) {
      const parsedCustomerNumber = parseSaleNumber(data.customerNumber);
      const customerByNumber = await Customer.findOne({
        createdBy: userId,
        $or: [
          { customerNumber: parsedCustomerNumber },
          { customer_number: String(parsedCustomerNumber ?? data.customerNumber) },
        ],
      }).select("_id");
      if (!customerByNumber) throw new Error("Customer not found");
      sale.customerId = customerByNumber._id as any;
      handledKeys.add("customerNumber");
    }
    if (typeof data.assignedTo !== "undefined" || data.assigneeEmail || data.assigneeName) {
      if (data.assignedTo === null) {
        sale.assignedTo = undefined;
      } else {
        const resolved = await resolveAssignee({
          assigneeEmail: data.assigneeEmail as string | undefined,
          assigneeId: data.assignedTo as string | undefined,
          assigneeName: data.assigneeName as string | undefined,
        });
        if (!resolved) throw new Error("Assignee not found");
        sale.assignedTo = new mongoose.Types.ObjectId(resolved);
      }
      handledKeys.add("assignedTo");
      handledKeys.add("assigneeEmail");
      handledKeys.add("assigneeName");
    }
    if (typeof data.raw_input !== "undefined") {
      sale.raw_input = data.raw_input as string;
      handledKeys.add("raw_input");
    }
    if (typeof data.parsed_input !== "undefined") {
      sale.parsed_input = data.parsed_input as any;
      handledKeys.add("parsed_input");
    }
    const blockedKeys = new Set([
      "_id",
      "createdBy",
      "saleNumber",
      "sale_number",
      "createdAt",
      "updatedAt",
      "__v",
    ]);
    Object.entries(data).forEach(([key, value]) => {
      if (handledKeys.has(key) || blockedKeys.has(key)) return;
      (sale as any)[key] = value;
    });
    if (!sale.saleNumber) {
      sale.saleNumber = await getNextSaleNumber(userId);
      sale.sale_number = String(sale.saleNumber);
    }

    await sale.save();
    await sale.populate("customerId", "name email customerNumber customer_number");
    await sale.populate("assignedTo", "name email");

    const performedBy = getPerformedBy(data);
    const assignmentRequested =
      typeof data.assignedTo !== "undefined" ||
      typeof data.assigneeEmail !== "undefined" ||
      typeof data.assigneeName !== "undefined";
    const unassignRequested = data.assignedTo === null;
    const nonAssignmentUpdates = Object.keys(data).some(
      (key) =>
        ![
          "assignedTo",
          "assigneeEmail",
          "assigneeName",
          "performedBy",
          "_performedBy",
        ].includes(key)
    );
    if (assignmentRequested) {
      await historyService.logAction({
        userId,
        entityType: "sale",
        entityNumber: sale.saleNumber,
        action: unassignRequested ? "unassign" : "assign",
        performedBy,
      });
    }
    if (nonAssignmentUpdates) {
      await historyService.logAction({
        userId,
        entityType: "sale",
        entityNumber: sale.saleNumber,
        action: "update",
        performedBy,
      });
    }
    return sale;
  },

  updateSaleByNumber: async (userId: string, saleNumber: number, data: Record<string, unknown>) => {
    return saleService.updateSaleFlexibleByNumber(userId, saleNumber, data);
  },

  deleteSaleByNumber: async (
    userId: string,
    saleNumber: number,
    performedBy: "user" | "ai" = "user"
  ) => {
    const sale = await Sale.findOneAndDelete({
      createdBy: userId,
      $or: [{ saleNumber }, { sale_number: String(saleNumber) }],
    });
    if (!sale) throw new Error("Sale not found");
    await historyService.logAction({
      userId,
      entityType: "sale",
      entityNumber: sale.saleNumber,
      action: "delete",
      performedBy,
    });
    return sale;
  },

  assignSaleByNumber: async (
    userId: string,
    saleNumber: number,
    assigneeEmail?: string,
    assigneeId?: string,
    assigneeName?: string,
    performedBy: "user" | "ai" = "user"
  ) => {
    const assignedTo = await resolveAssignee({ assigneeEmail, assigneeId, assigneeName });
    if (!assignedTo) throw new Error("Assignee is required");

    const sale = await Sale.findOne({
      createdBy: userId,
      $or: [{ saleNumber }, { sale_number: String(saleNumber) }],
    });
    if (!sale) throw new Error("Sale not found");

    sale.assignedTo = new mongoose.Types.ObjectId(assignedTo);
    if (!sale.saleNumber) {
      sale.saleNumber = await getNextSaleNumber(userId);
      sale.sale_number = String(sale.saleNumber);
    }
    await sale.save();
    await sale.populate("customerId", "name email customerNumber customer_number");
    await sale.populate("assignedTo", "name email");
    await historyService.logAction({
      userId,
      entityType: "sale",
      entityNumber: sale.saleNumber,
      action: "assign",
      performedBy,
    });
    return sale;
  },
};
