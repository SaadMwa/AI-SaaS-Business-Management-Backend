import { Router } from "express";
import { authenticate, requireAdmin } from "../middlewares/auth.middleware";
import { updateEntityByNumber } from "../controllers/entity.controller";

const router = Router();

router.patch("/:entityType/number/:entityNumber", authenticate, requireAdmin, updateEntityByNumber);

export default router;
