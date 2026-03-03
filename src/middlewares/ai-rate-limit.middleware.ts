import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

type BucketEvent = {
  ts: number;
  fingerprint?: string;
};

const WINDOW_MS = 60 * 1000;
const ADMIN_MAX_REQUESTS = 70;
const STORE_MAX_REQUESTS = 45;
const buckets = new Map<string, BucketEvent[]>();

type AiRateLimitOptions = {
  shouldCount?: (req: Request) => boolean;
};

const parseToken = (authorization?: string) => {
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : null;
  if (!token || !env.jwtSecret) return null;
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as {
      userId?: string;
      role?: string;
      store_id?: string;
    };
    return decoded;
  } catch {
    return null;
  }
};

const getClientKey = (req: Request) => {
  const decoded = parseToken(req.headers.authorization);
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  if (decoded?.role === "admin") {
    return `admin:${decoded.userId || ip}`;
  }
  return `store:${decoded?.store_id || decoded?.userId || ip}`;
};

const getLimit = (key: string) => (key.startsWith("admin:") ? ADMIN_MAX_REQUESTS : STORE_MAX_REQUESTS);

const getQuestionFingerprint = (req: Request) => {
  const raw = typeof req.body?.question === "string" ? req.body.question.trim().toLowerCase() : "";
  if (!raw) return "";
  return raw.replace(/\s+/g, " ").slice(0, 120);
};

export const aiRateLimit = (options: AiRateLimitOptions = {}) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (options.shouldCount && !options.shouldCount(req)) {
      return next();
    }

    const now = Date.now();
    const key = getClientKey(req);
    const limit = getLimit(key);
    const existing = buckets.get(key) || [];
    const windowStart = now - WINDOW_MS;
    const active = existing.filter((event) => event.ts > windowStart);
    const fingerprint = getQuestionFingerprint(req);
    const latest = active[active.length - 1];
    const isFastDuplicate =
      Boolean(fingerprint) &&
      Boolean(latest?.fingerprint) &&
      latest?.fingerprint === fingerprint &&
      now - latest.ts < 1500;

    if (isFastDuplicate) {
      return next();
    }

    if (active.length >= limit) {
      const oldest = active[0]?.ts || now;
      const retryAfter = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
      res.setHeader("Retry-After", retryAfter.toString());
      return res.status(429).json({
        success: false,
        code: "AI_RATE_LIMITED",
        message:
          "AI request limit reached for this minute. Confirmation, reset, and ping commands are not counted.",
        retryAfterSeconds: retryAfter,
        bucket: key.startsWith("admin:") ? "admin" : "store",
      });
    }

    active.push({ ts: now, fingerprint });
    buckets.set(key, active);
    return next();
  };
