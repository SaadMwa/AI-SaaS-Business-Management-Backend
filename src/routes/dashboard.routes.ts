import { Router } from "express";

import { authenticate, requireAdmin } from "../middlewares/auth.middleware";
import { getDashboard } from "../controllers/dashboard.controller";

const router = Router();

router.get("/", authenticate, requireAdmin, getDashboard);

export default router;
