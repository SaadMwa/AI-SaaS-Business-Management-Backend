import mongoose from "mongoose";
import { Counter } from "../models/counter";

export const getNextSequence = async (userId: string, key: string, seedFrom?: () => Promise<number>) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  let counter = await Counter.findOne({ userId: userObjectId, key }).lean();
  if (!counter) {
    const seed = seedFrom ? await seedFrom() : 0;
    try {
      await Counter.create({ userId: userObjectId, key, seq: seed });
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
    }
  }

  const updated = await Counter.findOneAndUpdate(
    { userId: userObjectId, key },
    { $inc: { seq: 1 } },
    { new: true }
  ).lean();

  return updated?.seq || 1;
};
