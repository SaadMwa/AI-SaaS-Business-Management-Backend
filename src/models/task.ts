import mongoose from "mongoose";

const taskSchema = new mongoose.Schema(
  {
    task_number: { type: Number, required: true, alias: "taskNumber" },
    raw_input: { type: String },
    parsed_input: { type: mongoose.Schema.Types.Mixed, default: {} },
    title: { type: String, required: true },
    description: { type: String },
    dueDate: { type: Date },
    status: {
      type: String,
      enum: ["todo", "in_progress", "in-progress", "done", "blocked"],
      default: "todo",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    relatedToType: {
      type: String,
      enum: ["customer", "sale"],
    },
    relatedToId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    tags: {
      type: [String],
      default: [],
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true, getters: true }, toObject: { virtuals: true, getters: true } }
);

taskSchema.index({ createdBy: 1, task_number: 1 }, { unique: true });

taskSchema.virtual("taskNumber").get(function () {
  return this.task_number;
});

export const Task = mongoose.model("Task", taskSchema);
