import mongoose from "mongoose";

const counterSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User" },
    key: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

counterSchema.index({ userId: 1, key: 1 }, { unique: true });

export const Counter = mongoose.model("Counter", counterSchema);
