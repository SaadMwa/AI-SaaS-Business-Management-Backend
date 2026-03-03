import { Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import {
  deleteUserById,
  getDashboardMessage,
  getAssignableUsers,
  getProfileData,
  getProtectedData,
} from "../services/user.service";
import { logger } from "../utils/logger";

export const getProfile = async (req: AuthRequest, res: Response) => {
  const user = await getProfileData(req.user?.userId);
  return res.json({ success: true, user });
};

export const deleteUser = (req: AuthRequest, res: Response) => {
  const result = deleteUserById(req.params.id);
  return res.json({ success: true, message: result.message });
};

export const getDashboard = (_req: AuthRequest, res: Response) => {
  const result = getDashboardMessage();
  return res.json({ success: true, message: result.message });
};

export const getProtected = (_req: AuthRequest, res: Response) => {
  const result = getProtectedData();
  return res.json({ success: true, data: result.data });
};

export const getUsers = async (_req: AuthRequest, res: Response) => {
  try {
    const users = await getAssignableUsers();
    return res.json({ success: true, users });
  } catch (error) {
    logger.error("user_list_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to fetch users" });
  }
};
