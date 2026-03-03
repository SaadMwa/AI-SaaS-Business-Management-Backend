import { Router } from "express";
import {
  authenticate,
  requireAdmin,
  refreshIfExpiringSoon,
} from "../middlewares/auth.middleware";
import {
  deleteUser,
  getDashboard,
  getProfile,
  getProtected,
  getUsers,
} from "../controllers/user.controller";

const router = Router();

router.get("/profile", authenticate, requireAdmin, getProfile);
router.get("/", authenticate, requireAdmin, getUsers);
router.delete("/users/:id", authenticate, requireAdmin, deleteUser);
router.get("/dashboard", authenticate, requireAdmin, getDashboard);
router.get("/protected-data", authenticate, requireAdmin, refreshIfExpiringSoon, getProtected);

export default router;
