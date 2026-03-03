import mongoose from "mongoose";
import { env } from "./env";
import { logger } from "../utils/logger";

type CachedConnection = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

const globalCache = global as typeof global & { _mongoose?: CachedConnection };

const cached: CachedConnection = globalCache._mongoose || { conn: null, promise: null };

if (!globalCache._mongoose) {
  globalCache._mongoose = cached;
}

export const connectDB = async (): Promise<typeof mongoose> => {
  const uri = env.databaseUrl;
  if (!uri) {
    throw new Error("DATABASE_URL is not set in environment variables");
  }

  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(uri, {
        maxPoolSize: env.dbPoolSize,
        serverSelectionTimeoutMS: env.dbServerSelectionTimeoutMs,
      })
      .then((mongooseInstance) => mongooseInstance)
      .catch((error) => {
        cached.promise = null;
        throw error;
      });
  }

  try {
    cached.conn = await cached.promise;
    return cached.conn;
  } catch (error) {
    logger.error("db_connection_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};
