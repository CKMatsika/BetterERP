import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { ApiError } from "../utils/ApiError";
import { logger } from "../lib/logger";

export function notFoundHandler(req: Request, _res: Response) {
  throw ApiError.notFound(`Route not found: ${req.method} ${req.path}`);
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  if (err instanceof ZodError) {
    return res.status(422).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: err.issues,
      },
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // Handle unique constraint violations
    if (err.code === "P2002") {
      const target = Array.isArray(err.meta?.target) ? err.meta?.target.join(", ") : err.meta?.target;
      return res.status(409).json({
        error: {
          code: "DUPLICATE_RECORD",
          message: `A record with the same value already exists${target ? ` (${target})` : ""}`,
        },
      });
    }
    if (err.code === "P2003") {
      return res.status(409).json({
        error: { code: "FOREIGN_KEY", message: "Related record does not exist or is in use" },
      });
    }
    if (err.code === "P2025") {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Record not found" },
      });
    }
    if (err.code === "P2014") {
      return res.status(400).json({
        error: { code: "RELATION_VIOLATION", message: "Relation constraint violation" },
      });
    }
  }

  logger.error("Unhandled error:", err);
  console.error(err);
  return res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
  });
}