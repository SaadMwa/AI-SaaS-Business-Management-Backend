import { Router } from "express";
import mongoose from "mongoose";
import authRoutes from "./auth.routes";
import userRoutes from "./user.routes";
import customerRoutes from "./customer.routes";
import saleRoutes from "./sale.routes";
import taskRoutes from "./task.routes";
import dashboardRoutes from "./dashboard.routes";
import insightsRoutes from "./insights.routes";
import entityRoutes from "./entity.routes";
import historyRoutes from "./history.routes";
import productRoutes from "./product.routes";
import { env } from "../config/env";

const router = Router();

router.get("/", (_req, res) => {
  res.json({ success: true, message: "API is running" });
});

const getHealthPayload = () => {
  const dbReady = mongoose.connection.readyState === 1;
  return {
    success: true,
    status: {
      api: "ok",
      db: dbReady ? "ok" : "degraded",
      ai: env.geminiApiKey || env.openaiApiKey ? "ok" : "degraded",
      ts: new Date().toISOString(),
    },
  };
};

router.get("/health", (_req, res) => {
  res.json(getHealthPayload());
});

router.get("/status", (_req, res) => {
  res.json(getHealthPayload());
});

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/customers", customerRoutes);
router.use("/sales", saleRoutes);
router.use("/tasks", taskRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/insights", insightsRoutes);
router.use("/entities", entityRoutes);
router.use("/history", historyRoutes);
router.use("/products", productRoutes);

export default router;
