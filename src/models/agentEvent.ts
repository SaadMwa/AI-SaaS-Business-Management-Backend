import mongoose from "mongoose";

const agentEventSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["task_created", "task_updated", "task_deleted", "task_overdue", "user_idle", "workload_spike"],
      required: true,
    },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["pending", "processed", "failed"], default: "pending" },
    scheduledFor: { type: Date },
    processedAt: { type: Date },
    error: { type: String },
  },
  { timestamps: true }
);

agentEventSchema.index({ userId: 1, type: 1, createdAt: -1 });
agentEventSchema.index({ status: 1, scheduledFor: 1 });

export const AgentEvent = mongoose.model("AgentEvent", agentEventSchema);
