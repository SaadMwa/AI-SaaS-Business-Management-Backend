import mongoose from "mongoose";
import { HistoryLog } from "../models/historyLog";
import { HistorySettings } from "../models/historySettings";

export type HistoryFilters = {
  entityType?: "task" | "customer" | "sale" | "ai";
  entityId?: number;
  actionType?: string;
  performedBy?: "user" | "ai";
  from?: string;
  to?: string;
  olderThanDays?: number;
  search?: string;
};

export const historyService = {
  logAction: async (params: {
    userId: string;
    entityType: "task" | "customer" | "sale" | "ai";
    entityNumber?: number | null;
    action: string;
    performedBy: "user" | "ai";
    meta?: Record<string, unknown>;
  }) => {
    return HistoryLog.create({
      userId: new mongoose.Types.ObjectId(params.userId),
      entityType: params.entityType,
      entityId: params.entityNumber ?? undefined,
      entityNumber: params.entityNumber ?? undefined,
      actionType: params.action,
      action: params.action,
      performedBy: params.performedBy,
      performedById:
        params.performedBy === "user" ? new mongoose.Types.ObjectId(params.userId) : undefined,
      details: params.meta || {},
      meta: params.meta || {},
    });
  },

  getHistory: async (userId: string, filters: HistoryFilters = {}) => {
    const query: Record<string, unknown> = { userId: new mongoose.Types.ObjectId(userId) };
    const orClauses: Record<string, unknown>[] = [];

    if (filters.entityType) query.entityType = filters.entityType;
    if (filters.entityId) {
      orClauses.push({ entityId: filters.entityId }, { entityNumber: filters.entityId });
    }
    if (filters.actionType) {
      orClauses.push({ actionType: filters.actionType }, { action: filters.actionType });
    }
    if (filters.performedBy) query.performedBy = filters.performedBy;
    if (filters.from || filters.to) {
      query.createdAt = {};
      if (filters.from) (query.createdAt as Record<string, unknown>).$gte = new Date(filters.from);
      if (filters.to) (query.createdAt as Record<string, unknown>).$lte = new Date(filters.to);
    }
    if (filters.olderThanDays) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - filters.olderThanDays);
      query.createdAt = { ...(query.createdAt as Record<string, unknown>), $lte: cutoff };
    }
    if (filters.search) {
      const search = filters.search.trim();
      if (search) {
        orClauses.push(
          { actionType: { $regex: search, $options: "i" } },
          { action: { $regex: search, $options: "i" } },
          { entityType: { $regex: search, $options: "i" } },
          { "details.question": { $regex: search, $options: "i" } },
          { "details.summary": { $regex: search, $options: "i" } }
        );
      }
    }
    if (orClauses.length) query.$or = orClauses;

    return HistoryLog.find(query).sort({ createdAt: -1 }).limit(500).lean();
  },

  getHistoryCount: async (userId: string, filters: HistoryFilters = {}) => {
    const query: Record<string, unknown> = { userId: new mongoose.Types.ObjectId(userId) };
    if (filters.entityType) query.entityType = filters.entityType;
    if (filters.performedBy) query.performedBy = filters.performedBy;
    if (filters.from || filters.to) {
      query.createdAt = {};
      if (filters.from) (query.createdAt as Record<string, unknown>).$gte = new Date(filters.from);
      if (filters.to) (query.createdAt as Record<string, unknown>).$lte = new Date(filters.to);
    }
    if (filters.olderThanDays) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - filters.olderThanDays);
      query.createdAt = { ...(query.createdAt as Record<string, unknown>), $lte: cutoff };
    }
    return HistoryLog.countDocuments(query);
  },

  deleteHistory: async (userId: string, filters: HistoryFilters = {}) => {
    const query: Record<string, unknown> = { userId: new mongoose.Types.ObjectId(userId) };
    const orClauses: Record<string, unknown>[] = [];

    if (filters.entityType) query.entityType = filters.entityType;
    if (filters.entityId) {
      orClauses.push({ entityId: filters.entityId }, { entityNumber: filters.entityId });
    }
    if (filters.actionType) {
      orClauses.push({ actionType: filters.actionType }, { action: filters.actionType });
    }
    if (filters.performedBy) query.performedBy = filters.performedBy;
    if (filters.from || filters.to) {
      query.createdAt = {};
      if (filters.from) (query.createdAt as Record<string, unknown>).$gte = new Date(filters.from);
      if (filters.to) (query.createdAt as Record<string, unknown>).$lte = new Date(filters.to);
    }
    if (filters.olderThanDays) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - filters.olderThanDays);
      query.createdAt = { ...(query.createdAt as Record<string, unknown>), $lte: cutoff };
    }
    if (orClauses.length) query.$or = orClauses;

    const result = await HistoryLog.deleteMany(query);
    return { deletedCount: result.deletedCount ?? 0 };
  },

  deleteHistoryEntry: async (userId: string, entryId: string) => {
    const result = await HistoryLog.deleteOne({
      _id: entryId,
      userId: new mongoose.Types.ObjectId(userId),
    });
    return { deletedCount: result.deletedCount ?? 0 };
  },

  exportHistory: async (userId: string, filters: HistoryFilters = {}, format: "json" | "csv" = "json") => {
    const records = await historyService.getHistory(userId, filters);
    if (format === "json") {
      return JSON.stringify(records, null, 2);
    }

    const header = [
      "timestamp",
      "entityType",
      "entityId",
      "action",
      "performedBy",
      "details",
    ];
    const rows = records.map((record) => [
      new Date(record.createdAt).toISOString(),
      record.entityType || "",
      String(record.entityId || record.entityNumber || ""),
      String(record.actionType || record.action || ""),
      String(record.performedBy || ""),
      JSON.stringify(record.details || record.meta || {}).replace(/"/g, '""'),
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    return csv;
  },

  getRetentionSettings: async (userId: string) => {
    const existing = await HistorySettings.findOne({
      userId: new mongoose.Types.ObjectId(userId),
    }).lean();
    if (existing) return existing;
    return HistorySettings.create({
      userId: new mongoose.Types.ObjectId(userId),
      retentionDays: 90,
    });
  },

  updateRetentionSettings: async (userId: string, retentionDays: number | null) => {
    return HistorySettings.findOneAndUpdate(
      { userId: new mongoose.Types.ObjectId(userId) },
      {
        $set: {
          retentionDays: retentionDays === null ? null : retentionDays,
          updatedBy: new mongoose.Types.ObjectId(userId),
        },
      },
      { upsert: true, new: true }
    ).lean();
  },

  cleanupOldHistory: async () => {
    const settings = await HistorySettings.find({ retentionDays: { $ne: null } })
      .select("userId retentionDays")
      .lean();

    const results = [];
    for (const setting of settings) {
      const retention = setting.retentionDays ?? 90;
      if (!retention || retention <= 0) continue;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - retention);
      const result = await HistoryLog.deleteMany({
        userId: setting.userId,
        createdAt: { $lte: cutoff },
      });
      results.push({ userId: setting.userId.toString(), deletedCount: result.deletedCount ?? 0 });
    }
    return results;
  },
};
