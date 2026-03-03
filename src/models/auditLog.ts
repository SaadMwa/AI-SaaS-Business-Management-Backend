import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    entityType: { type: String, enum: ["task"], required: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true },
    task_number: { type: Number },
    action: {
      type: String,
      enum: ["created", "updated", "assigned", "deleted", "status_changed", "priority_changed"],
      required: true,
    },
    summary: { type: String },
    before: { type: mongoose.Schema.Types.Mixed, default: {} },
    after: { type: mongoose.Schema.Types.Mixed, default: {} },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

export const AuditLog = mongoose.model("AuditLog", auditLogSchema);
