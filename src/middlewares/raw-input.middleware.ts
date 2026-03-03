import { Request, Response, NextFunction } from "express";

export interface RawInputRequest extends Request {
  rawText?: string;
  normalizedText?: string;
}

export const preserveRawInput = (req: RawInputRequest, _res: Response, next: NextFunction) => {
  const message = typeof req.body?.question === "string" ? req.body.question : req.body?.message;
  if (typeof message === "string") {
    req.rawText = message;
    req.normalizedText = message.trim().toLowerCase();
  }
  next();
};
