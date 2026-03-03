import { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/http-error";
import { logger } from "../utils/logger";

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  logger.error("unhandled_error", {
    error: err instanceof Error ? err.message : String(err),
  });
  // Honor HttpError status codes when provided.
  const status = err instanceof HttpError ? err.statusCode : 500;
  res.status(status).json({
    success: false,
    message: err.message || "Server error",
  });
};
