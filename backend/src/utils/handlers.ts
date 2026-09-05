import { Request, Response, NextFunction, RequestHandler } from "express";

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function parsePagination(query: Record<string, unknown>) {
  const page = Math.max(1, parseInt(query.page as string, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(query.pageSize as string, 10) || 25));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export function parseDateRange(query: Record<string, unknown>) {
  const toDate = (v: unknown): Date | undefined => {
    if (!v) return undefined;
    const d = new Date(v as string);
    return isNaN(d.getTime()) ? undefined : d;
  };
  let from = toDate(query.from);
  let to = toDate(query.to);
  if (to) {
    to = new Date(to.getTime() + 86400000 - 1);
  }
  return { from, to };
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function paginated<T>(items: T[], total: number, page: number, pageSize: number): PaginatedResult<T> {
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export function isUUID(id: string): boolean {
  return typeof id === "string" && id.length > 10;
}