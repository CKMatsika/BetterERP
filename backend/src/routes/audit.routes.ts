import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler, parsePagination } from "../utils/handlers";
import { requirePermission, effectiveBranchId } from "../middleware/auth";

const router = Router();

// GET /api/audit - list audit log entries with filters
router.get(
  "/",
  requirePermission("audit.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const companyId = req.user!.companyId;
    const where: Prisma.AuditLogWhereInput = { companyId };

    const branchId = effectiveBranchId(req);
    if (!req.user!.canViewAllBranches && branchId) where.branchId = branchId;
    if (req.query.branchId as string) where.branchId = req.query.branchId as string;
    if (req.query.userId as string) where.userId = req.query.userId as string;
    if (req.query.action as string) where.action = req.query.action as any;
    if (req.query.entity as string) where.entity = req.query.entity as string;
    if (req.query.entityId as string) where.entityId = req.query.entityId as string;
    if (req.query.from as string || req.query.to as string) {
      where.createdAt = {
        gte: req.query.from as string ? new Date(req.query.from as string) : undefined,
        lte: req.query.to as string ? new Date(new Date(req.query.to as string).getTime() + 86400000 - 1) : undefined,
      };
    }
    if (req.query.search as string) {
      where.OR = [
        { description: { contains: req.query.search as string, mode: "insensitive" } },
        { entity: { contains: req.query.search as string, mode: "insensitive" } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { id: true, fullName: true, username: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
    ]);
    res.json({ items, total, page, pageSize });
  })
);

// GET /api/audit/:id - single audit entry
router.get(
  "/:id",
  requirePermission("audit.view"),
  asyncHandler(async (req, res) => {
    const entry = await prisma.auditLog.findUnique({
      where: { id: req.params.id as string },
      include: { user: { select: { id: true, fullName: true, username: true } } },
    });
    if (!entry || entry.companyId !== req.user!.companyId) throw new Error("Audit log not found");
    res.json(entry);
  })
);

// GET /api/audit/trail/:entity/:entityId - trail for a specific entity
router.get(
  "/trail/:entity/:entityId",
  requirePermission("audit.view"),
  asyncHandler(async (req, res) => {
    const items = await prisma.auditLog.findMany({
      where: {
        companyId: req.user!.companyId,
        entity: req.params.entity as string,
        entityId: req.params.entityId as string,
      },
      include: { user: { select: { id: true, fullName: true, username: true } } },
      orderBy: { createdAt: "asc" },
    });
    res.json({ items });
  })
);

export default router;