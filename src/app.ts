import routes from "./routes";
import express from "express";
import cors from "cors";
import { notFound } from "./middlewares/not-found";
import { errorHandler } from "./middlewares/error-handler";
import aiRoute from "./routes/ai.route";
import { sanitizeInput } from "./middlewares/sanitize.middleware";
import { env } from "./config/env";
import { logger } from "./utils/logger";

const app = express();

const allowedOrigins = new Set<string>();

if (env.clientUrl) {
  allowedOrigins.add(env.clientUrl);
}

env.corsOrigins.forEach((origin) => allowedOrigins.add(origin));

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

app.use(express.json());
app.use(sanitizeInput);
app.use((_, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        allowAllOrigins ||
        allowedOrigins.has(origin) ||
        isLocalDevOrigin(origin)
      ) {
        return callback(null, true);
      }
      logger.warn("cors_blocked_origin", { origin });
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use("/api", routes);
app.use("/api/ai", aiRoute);

app.get("/", (_req, res) => {
  res.json({ success: true, message: "Backend API is running" });
});

app.use(notFound);
app.use(errorHandler);

export default app;
