import mongoose from "mongoose";

const historySettingsSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    retentionDays: { type: Number, default: 90 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const HistorySettings = mongoose.model("HistorySettings", historySettingsSchema);
