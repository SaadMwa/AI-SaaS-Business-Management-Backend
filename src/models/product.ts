import { Document, Schema, model } from "mongoose";

export interface IProduct extends Document {
  name: string;
  description: string;
  price: number;
  stock_quantity: number;
  image_url: string;
  category?: string;
  is_recommended?: boolean;
  popularity_score?: number;
  top_selling?: boolean;
  total_sold?: number;
  last_sold_at?: Date;
  embedding?: number[];
  embedding_updated_at?: Date;
  store_id: string;
  createdBy?: Schema.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    stock_quantity: { type: Number, required: true, min: 0, default: 0 },
    image_url: { type: String, required: true, trim: true },
    category: { type: String, trim: true, default: "General" },
    is_recommended: { type: Boolean, default: false },
    popularity_score: { type: Number, min: 0, max: 100, default: 50 },
    top_selling: { type: Boolean, default: false },
    total_sold: { type: Number, default: 0 },
    last_sold_at: { type: Date },
    embedding: {
      type: [Number],
      default: undefined,
      select: false,
    },
    embedding_updated_at: { type: Date },
    store_id: { type: String, required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

productSchema.index({
  name: "text",
  description: "text",
  category: "text",
});

export const Product = model<IProduct>("Product", productSchema);
