import mongoose from "mongoose";

const customerSchema = new mongoose.Schema(
  {
    customerNumber: { type: Number, required: false },
    customer_number: { type: String, required: false },
    raw_input: { type: String },
    parsed_input: { type: mongoose.Schema.Types.Mixed, default: {} },
    name: { type: String, required: true },
    email: { type: String },
    phone: { type: String },
    address: { type: String },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true, getters: true }, toObject: { virtuals: true, getters: true } }
);

customerSchema.index(
  { createdBy: 1, customerNumber: 1 },
  { unique: true, partialFilterExpression: { customerNumber: { $type: "number" } } }
);
customerSchema.index({ createdBy: 1, customer_number: 1 }, { unique: true, sparse: true });

export const Customer = mongoose.model("Customer", customerSchema);
