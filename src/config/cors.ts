import type { CorsOptions } from "cors";
import type { Request, Response } from "express";
import { env } from "./env";
import { logger } from "../utils/logger";

const normalizeOrigin = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
};

const allowedOrigins = new Set<string>();

const clientOrigin = normalizeOrigin(env.clientUrl);
if (clientOrigin) {
  allowedOrigins.add(clientOrigin);
}

env.corsOrigins
  .map(normalizeOrigin)
  .filter(Boolean)
  .forEach((origin) => allowedOrigins.add(origin));

if (process.env.NODE_ENV !== "production") {
  allowedOrigins.add("http://localhost:3000");
  allowedOrigins.add("http://localhost:5173");
}

const allowAllOrigins =
  process.env.NODE_ENV !== "production" && allowedOrigins.size === 0;

const isLocalDevOrigin = (origin: string) => {
  if (process.env.NODE_ENV === "production") return false;

  try {
    const { protocol, hostname } = new URL(origin);
    return (
      protocol === "http:" &&
      (hostname === "localhost" || hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
};

export const isCorsOriginAllowed = (origin?: string) => {
  if (!origin) return true;

  const normalized = normalizeOrigin(origin);
  return (
    allowAllOrigins ||
    allowedOrigins.has(normalized) ||
    isLocalDevOrigin(normalized)
  );
};

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (isCorsOriginAllowed(origin)) {
      return callback(null, true);
    }

    logger.warn("cors_blocked_origin", { origin });
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

export const applyCorsHeaders = (req: Request, res: Response) => {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || !isCorsOriginAllowed(origin)) return;

  res.setHeader("Access-Control-Allow-Origin", normalizeOrigin(origin));
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", corsOptions.methods as string[]);
  res.setHeader(
    "Access-Control-Allow-Headers",
    corsOptions.allowedHeaders as string[]
  );
};
