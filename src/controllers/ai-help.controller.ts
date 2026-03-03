import { Response } from "express";
import { aiHelpService } from "../services/ai-help.service";
import { AuthRequest } from "../middlewares/auth.middleware";

export const getAiGuide = (_req: AuthRequest, res: Response) => {
  const role = _req.user?.role || "admin";
  return res.json({ success: true, guide: aiHelpService.getGuide(role) });
};
