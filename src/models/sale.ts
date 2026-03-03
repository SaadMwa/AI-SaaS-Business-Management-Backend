import mongoose from "mongoose";

const saleItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const saleSchema = new mongoose.Schema(
  {
    saleNumber: { type: Number, required: false },
    sale_number: { type: String, required: false },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    items: {
      type: [saleItemSchema],
      required: true,
      validate: {
        validator: (items: unknown[]) => Array.isArray(items) && items.length > 0,
        message: "At least one item is required",
      },
    },
    total: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["draft", "pending", "paid", "cancelled", "refunded"],
      default: "draft",
    },
    date: { type: Date, default: Date.now },
    paymentMethod: {
      type: String,
      enum: ["card", "bank_transfer", "cash", "paypal", "other"],
      default: "other",
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    raw_input: { type: String },
    parsed_input: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true, getters: true }, toObject: { virtuals: true, getters: true } }
);

saleSchema.index(
  { createdBy: 1, saleNumber: 1 },
  { unique: true, partialFilterExpression: { saleNumber: { $type: "number" } } }
);
saleSchema.index({ createdBy: 1, sale_number: 1 }, { unique: true, sparse: true });

export const Sale = mongoose.model("Sale", saleSchema);
