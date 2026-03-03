import mongoose from "mongoose";

const agentLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    sessionId: { type: String },
    intent: { type: String, required: true },
    action: { type: String },
    status: { type: String, enum: ["pending", "success", "failed"], default: "pending" },
    riskLevel: { type: String, enum: ["low", "medium", "high"], default: "low" },
    confidence: { type: Number, default: 0 },
    input: { type: mongoose.Schema.Types.Mixed, default: {} },
    output: { type: mongoose.Schema.Types.Mixed, default: {} },
    error: { type: String },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

agentLogSchema.index({ userId: 1, createdAt: -1 });

export const AgentLog = mongoose.model("AgentLog", agentLogSchema);
