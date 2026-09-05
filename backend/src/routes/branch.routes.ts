import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { asyncHandler } from "../utils/handlers";
import { validateBody } from "../middleware/validate";
import { requirePermission, branchMatchesUser } from "../middleware/auth";

const router = Router();

const branchSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["HQ", "BRANCH", "WAREHOUSE_ONLY"]).default("BRANCH"),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  managerUserId: z.string().optional().nullable(),
  currency: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
  posConfiguration: z.record(z.string(), z.any()).optional(),
});

const warehouseSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  address: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
});

// GET /api/branches
router.get(
  "/",
  requirePermission("branch.view"),
  asyncHandler(async (req, res) => {
    const withDetails = req.query.details as string === "true";
    const branches = await prisma.branch.findMany({
      where: { companyId: req.user!.companyId },
      orderBy: { code: "asc" },
      include: withDetails
        ? {
            warehouses: true,
            bankAccounts: true,
            accounts: { where: { category: { in: ["CASH", "BANK"] } }, select: { id: true, code: true, name: true, category: true } },
            _count: { select: { users: true, employees: true, customers: true } },
          }
        : undefined,
    });
    res.json({ items: branches });
  })
);

// GET /api/branches/:id
router.get(
  "/:id",
  requirePermission("branch.view"),
  asyncHandler(async (req, res) => {
    const branch = await prisma.branch.findUnique({
      where: { id: req.params.id as string },
      include: {
        warehouses: { include: { locations: true } },
        bankAccounts: true,
        users: { select: { id: true, fullName: true, username: true } },
        employees: { select: { id: true, firstName: true, lastName: true, position: { select: { name: true } } } },
      },
    });
    if (!branch || branch.companyId !== req.user!.companyId) throw ApiError.notFound("Branch not found");
    res.json(branch);
  })
);

// POST /api/branches
router.post(
  "/",
  requirePermission("branch.create"),
  validateBody(branchSchema),
  asyncHandler(async (req, res) => {
    const branch = await prisma.$transaction(async (tx) => {
      const created = await tx.branch.create({
        data: { companyId: req.user!.companyId, ...req.body },
      });

      // Default warehouse for every new branch
      const wh = await tx.warehouse.create({
        data: {
          branchId: created.id,
          code: "MAIN",
          name: `${created.name} Main Warehouse`,
          isDefault: true,
        },
      });

      await tx.branch.update({ where: { id: created.id }, data: { defaultWarehouseId: wh.id } });

      // Create branch-specific cash & bank accounts from defaults
      await createBranchAccounts(tx as any, req.user!.companyId, created.id);

      return created;
    });

    res.status(201).json(branch);
  })
);

async function createBranchAccounts(tx: any, companyId: string, branchId: string) {
  const hqCash = await tx.account.findFirst({ where: { companyId, branchId: null, code: "1100" } });
  const hqBank = await tx.account.findFirst({ where: { companyId, branchId: null, code: "1201" } });
  const accounts: Array<{ code: string; name: string; type: string; category: string; normalBalance: string }> = [
    { code: "1100", name: `Cash - Branch`, type: "ASSET", category: "CASH", normalBalance: "DEBIT" },
    { code: "1201", name: `Bank - Operating`, type: "ASSET", category: "BANK", normalBalance: "DEBIT" },
  ];
  for (const acc of accounts) {
    const existing = await tx.account.findFirst({
      where: { companyId, branchId, code: acc.code },
    });
    if (!existing) {
      const isCash = acc.category === "CASH";
      await tx.account.create({
        data: {
          companyId,
          branchId,
          code: acc.code,
          name: isCash ? `Cash - ${branchId}` : `Bank - Operating ${branchId}`,
          type: acc.type as any,
          category: acc.category,
          normalBalance: acc.normalBalance as any,
          parentId: isCash ? hqCash?.id : hqBank?.id,
        },
      });
    }
  }
}

// PUT /api/branches/:id
router.put(
  "/:id",
  requirePermission("branch.edit"),
  validateBody(branchSchema.partial()),
  asyncHandler(async (req, res) => {
    const branch = await prisma.branch.findUnique({ where: { id: req.params.id as string } });
    if (!branch || branch.companyId !== req.user!.companyId) throw ApiError.notFound("Branch not found");
    const updated = await prisma.branch.update({
      where: { id: branch.id },
      data: req.body,
    });
    res.json(updated);
  })
);

// DELETE /api/branches/:id  (deactivate)
router.delete(
  "/:id",
  requirePermission("branch.delete"),
  asyncHandler(async (req, res) => {
    const branch = await prisma.branch.findUnique({ where: { id: req.params.id as string } });
    if (!branch || branch.companyId !== req.user!.companyId) throw ApiError.notFound("Branch not found");
    if (branch.type === "HQ") throw ApiError.badRequest("The HQ branch cannot be deactivated");
    const updated = await prisma.branch.update({
      where: { id: branch.id },
      data: { status: "INACTIVE" },
    });
    res.json(updated);
  })
);

// ===== Warehouses under a branch =====
router.get(
  "/:branchId/warehouses",
  requirePermission("warehouse.view"),
  asyncHandler(async (req, res) => {
    if (!branchMatchesUser(req, req.params.branchId as string)) {
      throw ApiError.forbidden("You do not have access to this branch's warehouses");
    }
    const items = await prisma.warehouse.findMany({
      where: { branchId: req.params.branchId as string, branch: { companyId: req.user!.companyId } },
      include: { locations: true, _count: { select: { stockBalances: true } } },
      orderBy: { code: "asc" },
    });
    res.json({ items });
  })
);

router.post(
  "/:branchId/warehouses",
  requirePermission("warehouse.create"),
  validateBody(warehouseSchema),
  asyncHandler(async (req, res) => {
    const branch = await prisma.branch.findUnique({ where: { id: req.params.branchId as string } });
    if (!branch || branch.companyId !== req.user!.companyId) throw ApiError.notFound("Branch not found");
    const wh = await prisma.warehouse.create({
      data: { branchId: req.params.branchId as string, ...req.body },
    });
    res.status(201).json(wh);
  })
);

router.put(
  "/warehouses/:warehouseId",
  requirePermission("warehouse.edit"),
  validateBody(warehouseSchema.partial()),
  asyncHandler(async (req, res) => {
    const wh = await prisma.warehouse.findUnique({ where: { id: req.params.warehouseId as string }, include: { branch: true } });
    if (!wh || wh.branch.companyId !== req.user!.companyId) throw ApiError.notFound("Warehouse not found");
    if (!branchMatchesUser(req, wh.branchId)) throw ApiError.forbidden("You do not have access to this warehouse");
    const updated = await prisma.warehouse.update({
      where: { id: wh.id },
      data: req.body,
    });
    res.json(updated);
  })
);

// Locations
router.get(
  "/:branchId/locations",
  requirePermission("location.view"),
  asyncHandler(async (req, res) => {
    if (!branchMatchesUser(req, req.params.branchId as string)) {
      throw ApiError.forbidden("You do not have access to this branch's locations");
    }
    const items = await prisma.warehouseLocation.findMany({
      where: { warehouse: { branchId: req.params.branchId as string, branch: { companyId: req.user!.companyId } } },
    });
    res.json({ items });
  })
);

router.post(
  "/warehouses/:warehouseId/locations",
  requirePermission("warehouse.edit"),
  validateBody(z.object({ code: z.string().min(1), name: z.string().min(1), description: z.string().optional().nullable() })),
  asyncHandler(async (req, res) => {
    const wh = await prisma.warehouse.findUnique({ where: { id: req.params.warehouseId as string }, include: { branch: true } });
    if (!wh || wh.branch.companyId !== req.user!.companyId) throw ApiError.notFound("Warehouse not found");
    if (!branchMatchesUser(req, wh.branchId)) throw ApiError.forbidden("You do not have access to this warehouse");
    const loc = await prisma.warehouseLocation.create({
      data: { warehouseId: wh.id, ...req.body },
    });
    res.status(201).json(loc);
  })
);

export { branchMatchesUser };
export default router;