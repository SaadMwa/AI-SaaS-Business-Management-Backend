import mongoose from "mongoose";

const aiMemorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    memoryType: { type: String, enum: ["short_term", "long_term"], required: true },
    content: { type: String, required: true },
  },
  { timestamps: { createdAt: false, updatedAt: "updatedAt" } }
);

aiMemorySchema.index({ userId: 1, memoryType: 1 });

export const AiMemory = mongoose.model("AiMemory", aiMemorySchema);
