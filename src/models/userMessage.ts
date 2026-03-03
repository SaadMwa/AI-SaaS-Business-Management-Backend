import mongoose from "mongoose";

const userMessageSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    rawText: { type: String, required: true },
    normalizedText: { type: String },
    channel: { type: String, enum: ["ai"], default: "ai" },
  },
  { timestamps: true }
);

userMessageSchema.index({ userId: 1, createdAt: -1 });

export const UserMessage = mongoose.model("UserMessage", userMessageSchema);
