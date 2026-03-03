import mongoose from "mongoose";

const taskHistorySchema = new mongoose.Schema(
  {
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true },
    task_number: { type: Number, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    action: {
      type: String,
      enum: ["created", "updated", "status_changed", "priority_changed", "assigned", "deleted"],
      required: true,
    },
    changes: { type: mongoose.Schema.Types.Mixed, default: {} },
    snapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

taskHistorySchema.index({ taskId: 1, createdAt: -1 });
taskHistorySchema.index({ userId: 1, createdAt: -1 });

export const TaskHistory = mongoose.model("TaskHistory", taskHistorySchema);
