import { Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import { Sale } from "../models/sale";
import { Customer } from "../models/customer";
import { saleService } from "../services/sale.service";
import { historyService } from "../services/history.service";
import { logger } from "../utils/logger";

const STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ["pending", "cancelled"],
  pending: ["paid", "cancelled"],
  paid: ["refunded"],
  cancelled: [],
  refunded: [],
};

const getUserId = (req: AuthRequest) => req.user?.userId;

const normalizeSaleNumber = (value?: string) => {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  const match = normalized.match(/\d+/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const handleSaleError = (res: Response, error: unknown, message: string) => {
  const detail = error instanceof Error ? error.message : "";
  if (detail === "Sale not found") {
    return res.status(404).json({ success: false, message: "Sale not found" });
  }
  if (detail === "Customer not found") {
    return res.status(404).json({ success: false, message: "Customer not found" });
  }
  if (detail === "Assignee not found") {
    return res.status(400).json({ success: false, message: "Assignee not found" });
  }
  if (detail.startsWith("Invalid status transition")) {
    return res.status(400).json({ success: false, message: detail });
  }
  logger.error("sale_error", {
    message,
    error: error instanceof Error ? error.message : String(error),
  });
  return res.status(500).json({ success: false, message: "Failed to process sale request" });
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

export const createSale = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { customerId, customerNumber, items, status, date, paymentMethod, raw_input, parsed_input } = req.body;
    const sale = await saleService.createSale(userId, {
      customerId,
      customerNumber,
      items,
      status,
      date,
      paymentMethod,
      raw_input,
      parsed_input,
    });

    return res.status(201).json({ success: true, sale });
  } catch (error) {
    return handleSaleError(res, error, "[Sale] create error");
  }
};

export const getSales = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { customerId, customerNumber, status, from, to } = req.query;
    const query: Record<string, unknown> = { createdBy: userId };

    if (customerId && typeof customerId === "string") {
      query.customerId = customerId;
    }
    if (!query.customerId && customerNumber && typeof customerNumber === "string") {
      const parsedNumber = normalizeSaleNumber(customerNumber);
      if (parsedNumber) {
        const customer = await Customer.findOne({
          createdBy: userId,
          $or: [{ customerNumber: parsedNumber }, { customer_number: String(parsedNumber) }],
        }).select("_id");
        if (customer?._id) {
          query.customerId = customer._id.toString();
        }
      }
    }
    if (status && typeof status === "string") {
      query.status = status;
    }
    if (from || to) {
      query.date = {};
      if (from && typeof from === "string") {
        (query.date as Record<string, unknown>).$gte = new Date(from);
      }
      if (to && typeof to === "string") {
        (query.date as Record<string, unknown>).$lte = new Date(to);
      }
    }

    const sales = await saleService.listSales(userId, query);
    return res.json({ success: true, sales });
  } catch (error) {
    return handleSaleError(res, error, "[Sale] list error");
  }
};

export const getSaleById = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const sale = await Sale.findOne({ _id: req.params.id, createdBy: userId }).populate(
      "customerId",
      "name email"
    );

    if (!sale) {
      return res.status(404).json({ success: false, message: "Sale not found" });
    }

    return res.json({ success: true, sale });
  } catch (error) {
    logger.error("sale_get_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to fetch sale" });
  }
};

export const getSaleByNumber = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const saleNumber = normalizeSaleNumber(req.params.sale_number);
    if (!saleNumber) {
      return res.status(400).json({ success: false, message: "Invalid sale number" });
    }

    const sale = await saleService.getSaleByNumber(userId, saleNumber);
    return res.json({ success: true, sale });
  } catch (error) {
    return handleSaleError(res, error, "[Sale] get by number error");
  }
};

export const updateSale = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const sale = await Sale.findOne({ _id: req.params.id, createdBy: userId });
    if (!sale) {
      return res.status(404).json({ success: false, message: "Sale not found" });
    }

    const { items, status, date, paymentMethod } = req.body;

    if (items) {
      const itemsValidation = validateItems(items);
      if (!itemsValidation.ok) {
        return res.status(400).json({ success: false, message: itemsValidation.message });
      }
      sale.items = items;
      sale.total = calculateTotal(items as { quantity: number; price: number }[]);
    }

    if (status) {
      if (!canTransition(sale.status, status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status transition from ${sale.status} to ${status}`,
        });
      }
      sale.status = status;
    }

    if (date) sale.date = new Date(date);
    if (paymentMethod) sale.paymentMethod = paymentMethod;

    await sale.save();

    await historyService.logAction({
      userId,
      entityType: "sale",
      entityNumber: sale.saleNumber,
      action: "update",
      performedBy: "user",
    });
    return res.json({ success: true, sale });
  } catch (error) {
    logger.error("sale_update_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to update sale" });
  }
};

export const updateSaleByNumber = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const saleNumber = normalizeSaleNumber(req.params.sale_number);
    if (!saleNumber) {
      return res.status(400).json({ success: false, message: "Invalid sale number" });
    }

    const sale = await saleService.updateSaleFlexibleByNumber(userId, saleNumber, req.body || {});
    return res.json({ success: true, sale });
  } catch (error) {
    return handleSaleError(res, error, "[Sale] update by number error");
  }
};

export const deleteSale = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const sale = await Sale.findOneAndDelete({ _id: req.params.id, createdBy: userId });
    if (!sale) {
      return res.status(404).json({ success: false, message: "Sale not found" });
    }

    await historyService.logAction({
      userId,
      entityType: "sale",
      entityNumber: sale.saleNumber,
      action: "delete",
      performedBy: "user",
    });

    return res.json({ success: true, message: "Sale deleted" });
  } catch (error) {
    logger.error("sale_delete_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to delete sale" });
  }
};

export const deleteSaleByNumber = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const saleNumber = normalizeSaleNumber(req.params.sale_number);
    if (!saleNumber) {
      return res.status(400).json({ success: false, message: "Invalid sale number" });
    }

    await saleService.deleteSaleByNumber(userId, saleNumber);
    return res.json({ success: true, message: "Sale deleted" });
  } catch (error) {
    return handleSaleError(res, error, "[Sale] delete by number error");
  }
};

export const assignSaleByNumber = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const saleNumber = normalizeSaleNumber(req.params.sale_number);
    if (!saleNumber) {
      return res.status(400).json({ success: false, message: "Invalid sale number" });
    }

    const { assigneeEmail, assigneeName, assignedTo } = req.body || {};
    const sale = await saleService.assignSaleByNumber(
      userId,
      saleNumber,
      assigneeEmail,
      assignedTo,
      assigneeName
    );
    return res.json({ success: true, sale });
  } catch (error) {
    return handleSaleError(res, error, "[Sale] assign by number error");
  }
};
