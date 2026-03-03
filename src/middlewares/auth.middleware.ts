import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { JwtUserPayload, UserRole } from "../types/auth";
import { logger } from "../utils/logger";

const TOKEN_PREFIX = "Bearer";

export interface AuthRequest extends Request {
  user?: JwtUserPayload;
}

const extractTokenFromHeader = (authorizationHeader?: string): string | null => {
  if (!authorizationHeader || !authorizationHeader.startsWith(TOKEN_PREFIX)) {
    return null;
  }

  return authorizationHeader.split(" ")[1] || null;
};

const sendErrorResponse = (res: Response, statusCode: number, message: string) => {
  res.status(statusCode).json({
    success: false,
    error: message,
    timestamp: new Date().toISOString(),
  });
};

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = extractTokenFromHeader(req.headers.authorization);

    if (!token) {
      return sendErrorResponse(res, 401, "Authentication required. Please provide a valid token.");
    }

    if (!env.jwtSecret) {
      return sendErrorResponse(res, 500, "JWT secret is not configured.");
    }

    const decoded = jwt.verify(token, env.jwtSecret) as JwtUserPayload;

    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
      return sendErrorResponse(res, 401, "Token has expired. Please login again.");
    }

    if (!decoded.userId || !decoded.role || !decoded.store_id) {
      return sendErrorResponse(res, 401, "Invalid token structure.");
    }

    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      store_id: decoded.store_id,
      full_access: decoded.full_access ?? decoded.role === "admin",
      iat: decoded.iat,
      exp: decoded.exp,
    };

    logger.debug("auth_ok", { userId: decoded.userId, method: req.method, path: req.path });

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return sendErrorResponse(res, 401, "Token has expired.");
    }

    if (error instanceof jwt.JsonWebTokenError) {
      return sendErrorResponse(res, 401, "Invalid token.");
    }

    logger.error("auth_error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return sendErrorResponse(res, 500, "Internal authentication error.");
  }
};

export const requireRole = (...allowedRoles: UserRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return sendErrorResponse(res, 401, "Authentication required.");
    }

    if (!allowedRoles.includes(req.user.role)) {
      const roles = allowedRoles.join(", ");
      return sendErrorResponse(
        res,
        403,
        `Insufficient permissions. Required roles: ${roles}. Your role: ${req.user.role}`
      );
    }

    next();
  };
};

export const requireAdmin = requireRole("admin");
export const requireModerator = requireRole("admin");
export const requireUser = requireRole("admin");

export const refreshIfExpiringSoon = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user || !req.user.exp) return next();

  const expiresIn = req.user.exp - Math.floor(Date.now() / 1000);
  const THRESHOLD = 300;

  if (expiresIn < THRESHOLD && expiresIn > 0) {
    res.setHeader("X-Token-Expiring-Soon", "true");
  }

  next();
};
