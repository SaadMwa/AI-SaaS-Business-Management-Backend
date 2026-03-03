import mongoose from "mongoose";

const agentMemorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    sessionId: { type: String },
    type: {
      type: String,
      enum: ["short_term", "long_term", "semantic", "pending_confirmation"],
      required: true,
    },
    key: { type: String },
    content: { type: String, required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    embedding: { type: [Number], default: [] },
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

agentMemorySchema.index({ userId: 1, type: 1, createdAt: -1 });
agentMemorySchema.index({ userId: 1, key: 1 });
agentMemorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AgentMemory = mongoose.model("AgentMemory", agentMemorySchema);
