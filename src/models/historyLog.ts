import mongoose from "mongoose";

const historyLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    entityType: { type: String, enum: ["task", "customer", "sale", "ai"], required: true },
    entityId: { type: Number },
    entityNumber: { type: Number },
    actionType: { type: String, required: true },
    action: { type: String },
    performedBy: { type: String, required: true },
    performedById: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

historyLogSchema.index({ userId: 1, createdAt: -1 });
historyLogSchema.index({ entityType: 1, entityNumber: 1, createdAt: -1 });
historyLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
historyLogSchema.index({ performedBy: 1, createdAt: -1 });
historyLogSchema.index({ actionType: 1, createdAt: -1 });

export const HistoryLog = mongoose.model("HistoryLog", historyLogSchema);
