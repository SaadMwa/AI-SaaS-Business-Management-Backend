import { Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import { Customer } from "../models/customer";
import { customerService } from "../services/customer.service";
import { historyService } from "../services/history.service";
import { logger } from "../utils/logger";

const getUserId = (req: AuthRequest) => req.user?.userId;

const normalizeCustomerNumber = (value?: string) => {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  const match = normalized.match(/\d+/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const handleCustomerError = (res: Response, error: unknown, message: string) => {
  const detail = error instanceof Error ? error.message : "";
  if (detail === "Customer not found") {
    return res.status(404).json({ success: false, message: "Customer not found" });
  }
  logger.error("customer_error", {
    message,
    error: error instanceof Error ? error.message : String(error),
  });
  return res.status(500).json({ success: false, message: "Failed to process customer request" });
};

export const createCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { name, email, phone, address, raw_input, parsed_input } = req.body;
    if (!name && !raw_input) {
      return res.status(400).json({ success: false, message: "Customer name is required" });
    }

    const customer = await customerService.createCustomer(userId, {
      name,
      email,
      phone,
      address,
      raw_input,
      parsed_input,
    });

    return res.status(201).json({ success: true, customer });
  } catch (error) {
    return handleCustomerError(res, error, "[Customer] create error");
  }
};

export const getCustomers = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { q } = req.query;
    const search = typeof q === "string" ? q.trim() : "";
    const customers = await customerService.listCustomers(userId, search);
    return res.json({ success: true, customers });
  } catch (error) {
    return handleCustomerError(res, error, "[Customer] list error");
  }
};

export const getCustomerById = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const customer = await Customer.findOne({ _id: req.params.id, createdBy: userId });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    return res.json({ success: true, customer });
  } catch (error) {
    logger.error("customer_get_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to fetch customer" });
  }
};

export const getCustomerByNumber = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const customerNumber = normalizeCustomerNumber(req.params.customer_number);
    if (!customerNumber) {
      return res.status(400).json({ success: false, message: "Invalid customer number" });
    }

    const customer = await customerService.getCustomerByNumber(userId, customerNumber);
    return res.json({ success: true, customer });
  } catch (error) {
    return handleCustomerError(res, error, "[Customer] get by number error");
  }
};

export const updateCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { name, email, phone, address } = req.body;
    const customer = await Customer.findOneAndUpdate(
      { _id: req.params.id, createdBy: userId },
      { name, email, phone, address },
      { new: true }
    );

    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    await historyService.logAction({
      userId,
      entityType: "customer",
      entityNumber: customer.customerNumber,
      action: "update",
      performedBy: "user",
    });

    return res.json({ success: true, customer });
  } catch (error) {
    logger.error("customer_update_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to update customer" });
  }
};

export const updateCustomerByNumber = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const customerNumber = normalizeCustomerNumber(req.params.customer_number);
    if (!customerNumber) {
      return res.status(400).json({ success: false, message: "Invalid customer number" });
    }

    const customer = await customerService.updateCustomerFlexibleByNumber(
      userId,
      customerNumber,
      req.body || {}
    );
    return res.json({ success: true, customer });
  } catch (error) {
    return handleCustomerError(res, error, "[Customer] update by number error");
  }
};

export const deleteCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const customer = await Customer.findOneAndDelete({ _id: req.params.id, createdBy: userId });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    await historyService.logAction({
      userId,
      entityType: "customer",
      entityNumber: customer.customerNumber,
      action: "delete",
      performedBy: "user",
    });

    return res.json({ success: true, message: "Customer deleted" });
  } catch (error) {
    logger.error("customer_delete_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to delete customer" });
  }
};

export const deleteCustomerByNumber = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const customerNumber = normalizeCustomerNumber(req.params.customer_number);
    if (!customerNumber) {
      return res.status(400).json({ success: false, message: "Invalid customer number" });
    }

    await customerService.deleteCustomerByNumber(userId, customerNumber);
    return res.json({ success: true, message: "Customer deleted" });
  } catch (error) {
    return handleCustomerError(res, error, "[Customer] delete by number error");
  }
};
