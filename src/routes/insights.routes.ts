import { Router } from "express";
import { authenticate, requireAdmin } from "../middlewares/auth.middleware";
import { getInsights } from "../controllers/insights.controller";

const router = Router();

router.get("/", authenticate, requireAdmin, getInsights);

export default router;
