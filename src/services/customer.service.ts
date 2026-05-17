import mongoose from "mongoose";
import { Customer } from "../models/customer";
import { getNextSequence, syncSequence } from "./counter.service";
import { historyService } from "./history.service";

const parseCustomerNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/\d+/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const getPerformedBy = (payload?: Record<string, unknown>) => {
  const value = payload?.performedBy || payload?._performedBy;
  return value === "ai" ? "ai" : "user";
};

const getMaxCustomerNumber = async (userId: string) => {
  const result = await Customer.aggregate([
    { $match: { createdBy: new mongoose.Types.ObjectId(userId) } },
    {
      $addFields: {
        normalized: {
          $ifNull: [
            "$customerNumber",
            {
              $let: {
                vars: {
                  matchObj: { $regexFind: { input: "$customer_number", regex: /\d+/ } },
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

const getNextCustomerNumber = async (userId: string) => {
  return getNextSequence(userId, "customer", () => getMaxCustomerNumber(userId));
};

const ensureCustomerNumbers = async (userId: string, customers: any[]) => {
  const ordered = [...customers].sort((a, b) => {
    const aTime = new Date(a.createdAt || 0).getTime();
    const bTime = new Date(b.createdAt || 0).getTime();
    if (aTime !== bTime) return aTime - bTime;
    return String(a._id).localeCompare(String(b._id));
  });

  let changed = false;
  const updates: Array<{ id: mongoose.Types.ObjectId; number: number }> = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const nextNumber = index + 1;
    const customer = ordered[index];
    updates.push({ id: customer._id, number: nextNumber });
    if (
      customer.customerNumber === nextNumber &&
      String(customer.customer_number || "") === String(nextNumber)
    ) {
      continue;
    }

    changed = true;
    customer.customerNumber = nextNumber;
    customer.customer_number = String(nextNumber);
  }

  if (changed) {
    await Customer.bulkWrite(
      updates.map((update, index) => ({
        updateOne: {
          filter: { _id: update.id },
          update: {
            $set: {
              customerNumber: -(index + 1),
              customer_number: `__renumbering_${String(update.id)}`,
            },
          },
        },
      }))
    );
    await Customer.bulkWrite(
      updates.map((update) => ({
        updateOne: {
          filter: { _id: update.id },
          update: {
            $set: {
              customerNumber: update.number,
              customer_number: String(update.number),
            },
          },
        },
      }))
    );
  }

  if (changed || ordered.length) {
    await syncSequence(userId, "customer", ordered.length);
  }

  return ordered;
};

export const customerService = {
  listCustomers: async (userId: string, search?: string) => {
    const query: Record<string, unknown> = { createdBy: userId };
    if (search) {
      const parsed = parseCustomerNumber(search);
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
        ...(parsed ? [{ customerNumber: parsed }] : []),
        { customer_number: { $regex: search, $options: "i" } },
      ];
    }
    const customers = await Customer.find(query).sort({ customerNumber: 1, createdAt: -1 });
    return ensureCustomerNumbers(userId, customers as any[]);
  },

  getCustomerByNumber: async (userId: string, customerNumber: number) => {
    const customer = await Customer.findOne({
      createdBy: userId,
      $or: [{ customerNumber }, { customer_number: String(customerNumber) }],
    });
    if (!customer) throw new Error("Customer not found");
    if (!customer.customerNumber) {
      const parsedLegacy = parseCustomerNumber(customer.customer_number);
      if (parsedLegacy) {
        customer.customerNumber = parsedLegacy;
        await customer.save();
      }
    }
    return customer;
  },

  createCustomer: async (userId: string, data: Record<string, unknown>) => {
    const raw_input =
      (data.raw_input as string) ||
      (data.rawInput as string) ||
      (data.rawText as string) ||
      (data.name as string) ||
      "";
    const name = (data.name as string) || raw_input;
    if (!name) throw new Error("Customer name is required");

    let customer;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const customerNumber = await getNextCustomerNumber(userId);
        customer = await Customer.create({
          customerNumber,
          customer_number: String(customerNumber),
          raw_input,
          parsed_input: data.parsed_input || {},
          name,
          email: data.email,
          phone: data.phone,
          address: data.address,
          createdBy: new mongoose.Types.ObjectId(userId),
        });
        break;
      } catch (error: any) {
        if (error?.code === 11000 && attempt < 2) continue;
        throw error;
      }
    }

    if (!customer) throw new Error("Failed to create customer");

    await historyService.logAction({
      userId,
      entityType: "customer",
      entityNumber: customer.customerNumber,
      action: "create",
      performedBy: getPerformedBy(data),
      meta: { name: customer.name },
    });
    return customer;
  },

  updateCustomerFlexibleByNumber: async (
    userId: string,
    customerNumber: number,
    updates: Record<string, unknown>
  ) => {
    const customer = await Customer.findOne({
      createdBy: userId,
      $or: [{ customerNumber }, { customer_number: String(customerNumber) }],
    });
    if (!customer) throw new Error("Customer not found");

    const handledKeys = new Set<string>();
    if (typeof updates.name === "string") {
      customer.name = updates.name;
      handledKeys.add("name");
    }
    if (typeof updates.email !== "undefined") {
      customer.email = updates.email === null ? undefined : (updates.email as string);
      handledKeys.add("email");
    }
    if (typeof updates.phone !== "undefined") {
      customer.phone = updates.phone === null ? undefined : (updates.phone as string);
      handledKeys.add("phone");
    }
    if (typeof updates.address !== "undefined") {
      customer.address = updates.address === null ? undefined : (updates.address as string);
      handledKeys.add("address");
    }
    if (typeof updates.raw_input !== "undefined") {
      customer.raw_input = updates.raw_input as string;
      handledKeys.add("raw_input");
    }
    if (typeof updates.parsed_input !== "undefined") {
      customer.parsed_input = updates.parsed_input as any;
      handledKeys.add("parsed_input");
    }

    const blockedKeys = new Set([
      "_id",
      "createdBy",
      "customerNumber",
      "customer_number",
      "createdAt",
      "updatedAt",
      "__v",
    ]);
    Object.entries(updates).forEach(([key, value]) => {
      if (handledKeys.has(key) || blockedKeys.has(key)) return;
      (customer as any)[key] = value;
    });

    if (!customer.customerNumber) {
      customer.customerNumber = await getNextCustomerNumber(userId);
      customer.customer_number = String(customer.customerNumber);
    }

    await customer.save();

    await historyService.logAction({
      userId,
      entityType: "customer",
      entityNumber: customer.customerNumber,
      action: "update",
      performedBy: getPerformedBy(updates),
    });
    return customer;
  },

  updateCustomerByNumber: async (
    userId: string,
    customerNumber: number,
    data: Record<string, unknown>
  ) => {
    return customerService.updateCustomerFlexibleByNumber(userId, customerNumber, data);
  },

  deleteCustomerByNumber: async (
    userId: string,
    customerNumber: number,
    performedBy: "user" | "ai" = "user"
  ) => {
    const customer = await Customer.findOneAndDelete({
      createdBy: userId,
      $or: [{ customerNumber }, { customer_number: String(customerNumber) }],
    });
    if (!customer) throw new Error("Customer not found");
    await historyService.logAction({
      userId,
      entityType: "customer",
      entityNumber: customer.customerNumber,
      action: "delete",
      performedBy,
    });
    return customer;
  },
};
