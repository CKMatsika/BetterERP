import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { asyncHandler, parsePagination } from "../utils/handlers";
import { validateBody } from "../middleware/validate";
import { requirePermission, effectiveBranchId } from "../middleware/auth";
import { postJournal } from "../services/accounting.service";
import { getPostingAccounts, ACCOUNT_CODES } from "../services/postingAccounts.service";
import { writeAudit } from "../services/audit.service";
import { AuditAction } from "@prisma/client";
import { nextReference } from "../services/sequence.service";
import { d, mul } from "../utils/money";

const router = Router();

// ==================== ASSET CATEGORIES ====================

router.get(
  "/categories",
  requirePermission("asset.view"),
  asyncHandler(async (req, res) => {
    const items = await prisma.assetCategory.findMany({
      where: { companyId: req.user!.companyId },
      include: { _count: { select: { assets: true } } },
      orderBy: { name: "asc" },
    });
    res.json({ items });
  })
);

router.post(
  "/categories",
  requirePermission("asset.create"),
  validateBody(z.object({
    name: z.string().min(1),
    depreciationRate: z.coerce.number().min(0).max(100),
    depreciationMethod: z.string().default("STRAIGHT_LINE"),
    expenseAccountId: z.string().optional().nullable(),
    assetAccountId: z.string().optional().nullable(),
  })),
  asyncHandler(async (req, res) => {
    const existing = await prisma.assetCategory.findUnique({
      where: { companyId_name: { companyId: req.user!.companyId, name: req.body.name } },
    });
    if (existing) throw ApiError.badRequest("Category name already exists");
    const category = await prisma.assetCategory.create({
      data: { companyId: req.user!.companyId, ...req.body },
    });
    res.status(201).json(category);
  })
);

// ==================== ASSETS ====================

const assetSchema = z.object({
  categoryId: z.string().optional().nullable(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  serialNumber: z.string().optional().nullable(),
  purchaseDate: z.coerce.date().optional().nullable(),
  purchaseCost: z.coerce.number().min(0),
  salvageValue: z.coerce.number().min(0).optional(),
  usefulLifeYears: z.number().int().positive().optional(),
  depreciationRate: z.coerce.number().min(0).max(100).optional(),
  location: z.string().optional().nullable(),
  assignedTo: z.string().optional().nullable(),
  assignedEmployeeId: z.string().optional().nullable(),
  supplierId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  branchId: z.string().optional(),
});

router.get(
  "/",
  requirePermission("asset.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const where: Prisma.AssetWhereInput = { companyId: req.user!.companyId };
    const branchId = effectiveBranchId(req);
    if (!req.user!.canViewAllBranches && branchId) where.branchId = branchId;
    if (req.query.branchId as string) where.branchId = req.query.branchId as string;
    if (req.query.status as string) where.status = req.query.status as string;
    if (req.query.categoryId as string) where.categoryId = req.query.categoryId as string;
    if (req.query.search as string) {
      const q = req.query.search as string;
      where.OR = [
        { assetNumber: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { serialNumber: { contains: q, mode: "insensitive" } },
      ];
    }
    const [total, items] = await Promise.all([
      prisma.asset.count({ where }),
      prisma.asset.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          assignedEmployee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
        },
        orderBy: { assetNumber: "asc" },
        skip,
        take: pageSize,
      }),
    ]);
    res.json({ items, total, page, pageSize });
  })
);

router.get(
  "/:id",
  requirePermission("asset.view"),
  asyncHandler(async (req, res) => {
    const asset = await prisma.asset.findUnique({
      where: { id: req.params.id as string },
      include: {
        category: true,
        assignedEmployee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
        deprecations: { orderBy: { bookedAt: "desc" } },
      },
    });
    if (!asset || asset.companyId !== req.user!.companyId) throw ApiError.notFound("Asset not found");
    res.json(asset);
  })
);

router.post(
  "/",
  requirePermission("asset.create"),
  validateBody(assetSchema),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    return prisma.$transaction(async (tx) => {
      const ref = await nextReference({ companyId, branchId: req.body.branchId, docType: "ASSET" });
      const asset = await tx.asset.create({
        data: {
          companyId,
          assetNumber: ref,
          ...req.body,
          bookValue: req.body.purchaseCost,
        },
      });

      // Journal: Debit asset account, Credit AP/Payable
      const postingAccounts = await getPostingAccounts(tx as any, companyId, req.body.branchId ?? null);
      let assetAccountId = postingAccounts.inventoryId;
      if (req.body.categoryId) {
        const cat = await tx.assetCategory.findUnique({ where: { id: req.body.categoryId } });
        if (cat?.assetAccountId) assetAccountId = cat.assetAccountId;
      }
      await postJournal(tx as any, {
        companyId,
        branchId: req.body.branchId ?? null,
        description: `Asset purchase: ${req.body.name}`,
        entryType: "PURCHASE",
        sourceType: "ASSET",
        sourceId: asset.id,
        userId: req.user!.id,
        lines: [
          { accountId: assetAccountId, debit: req.body.purchaseCost, description: `Asset: ${req.body.name}` },
          { accountId: postingAccounts.apTradeId, credit: req.body.purchaseCost, description: `Asset: ${req.body.name}` },
        ],
      });

      await writeAudit(tx as any, {
        companyId,
        branchId: req.body.branchId ?? null,
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entity: "ASSET",
        entityId: asset.id,
        afterJson: { assetNumber: ref, name: req.body.name, purchaseCost: req.body.purchaseCost },
      });
      return asset;
    }).then((r) => res.status(201).json(r));
  })
);

router.put(
  "/:id",
  requirePermission("asset.edit"),
  validateBody(assetSchema.partial()),
  asyncHandler(async (req, res) => {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id as string } });
    if (!asset || asset.companyId !== req.user!.companyId) throw ApiError.notFound("Asset not found");
    const updated = await prisma.asset.update({ where: { id: asset.id }, data: req.body });
    res.json(updated);
  })
);

// Run depreciation (batch)
router.post(
  "/depreciate",
  requirePermission("asset.depreciate"),
  validateBody(z.object({
    periodName: z.string().min(1),
    periodDate: z.coerce.date(),
    branchId: z.string().optional(),
  })),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    return prisma.$transaction(async (tx) => {
      const assets = await tx.asset.findMany({
        where: { companyId, status: "ACTIVE" },
        include: { category: true },
      });

      const postingAccounts = await getPostingAccounts(tx as any, companyId, req.body.branchId ?? null);
      let totalDepreciation = d(0);
      const journalLines: any[] = [];

      for (const asset of assets) {
        const rate = asset.depreciationRate.toNumber() || asset.category?.depreciationRate?.toNumber() || 0;
        if (rate === 0) continue;

        const depreciationAmount = mul(d(asset.bookValue), d(rate).div(100));
        if (depreciationAmount.isZero() || depreciationAmount.isNegative()) continue;

        const newBookValue = d(asset.bookValue).minus(depreciationAmount);
        const newAccumulated = d(asset.accumulatedDepreciation).plus(depreciationAmount);

        await tx.assetDepreciation.create({
          data: { assetId: asset.id, period: req.body.periodName, amount: depreciationAmount },
        });

        await tx.asset.update({
          where: { id: asset.id },
          data: { accumulatedDepreciation: newAccumulated, bookValue: newBookValue },
        });

        totalDepreciation = totalDepreciation.plus(depreciationAmount);

        const expenseAccountId = asset.category?.expenseAccountId ?? await resolveAccountCode(tx as any, companyId, ACCOUNT_CODES.depreciation);
        const accumAccountId = await resolveAccountCode(tx as any, companyId, ACCOUNT_CODES.accumulatedDepreciation);

        journalLines.push(
          { accountId: expenseAccountId, debit: depreciationAmount, description: `Depreciation: ${asset.name}` },
          { accountId: accumAccountId, credit: depreciationAmount, description: `Depreciation: ${asset.name}` },
        );
      }

      if (journalLines.length > 0) {
        await postJournal(tx as any, {
          companyId,
          branchId: req.body.branchId ?? null,
          description: `Depreciation run: ${req.body.periodName}`,
          entryType: "DEPRECIATION",
          userId: req.user!.id,
          lines: journalLines,
        });
      }

      return res.json({ depreciated: assets.length, totalDepreciation: totalDepreciation.toNumber() });
    }).then((r) => r);
  })
);

// Dispose asset
router.post(
  "/:id/dispose",
  requirePermission("asset.dispose"),
  validateBody(z.object({ disposalDate: z.coerce.date(), disposalAmount: z.coerce.number().min(0), reason: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id as string } });
    if (!asset || asset.companyId !== req.user!.companyId) throw ApiError.notFound("Asset not found");
    if (asset.status === "DISPOSED") throw ApiError.badRequest("Asset already disposed");

    return prisma.$transaction(async (tx) => {
      const bookValue = d(asset.bookValue);
      const disposalAmount = d(req.body.disposalAmount);
      const gainLoss = disposalAmount.minus(bookValue);

      await tx.asset.update({
        where: { id: asset.id },
        data: { status: "DISPOSED", notes: `Disposed: ${req.body.reason ?? ""}` },
      });

      // Journal: Debit cash/receivable, Debit accumulated depreciation, Credit asset, Credit/Debit gain/loss
      const postingAccounts = await getPostingAccounts(tx as any, asset.companyId, asset.branchId);
      const lines: any[] = [
        { accountId: postingAccounts.cashAccountId, debit: disposalAmount, description: `Disposal: ${asset.name}` },
        { accountId: postingAccounts.inventoryId, credit: bookValue, description: `Disposal: ${asset.name}` },
      ];

      if (asset.accumulatedDepreciation.isPositive()) {
        const accumAcc = await resolveAccountCode(tx as any, asset.companyId, ACCOUNT_CODES.accumulatedDepreciation);
        lines.push({ accountId: accumAcc, debit: asset.accumulatedDepreciation, description: `Disposal: ${asset.name}` });
      }

      if (gainLoss.isNegative()) {
        lines.push({ accountId: postingAccounts.otherExpenses, debit: gainLoss.abs(), description: `Loss on disposal: ${asset.name}` });
      } else if (gainLoss.isPositive()) {
        lines.push({ accountId: postingAccounts.salesRevenueId, credit: gainLoss, description: `Gain on disposal: ${asset.name}` });
      }

      await postJournal(tx as any, {
        companyId: asset.companyId,
        branchId: asset.branchId,
        description: `Asset disposal: ${asset.name}`,
        entryType: "ADJUSTMENT",
        sourceType: "ASSET",
        sourceId: asset.id,
        userId: req.user!.id,
        lines,
      });

      return res.json({ success: true, gainLoss: gainLoss.toNumber() });
    }).then((r) => r);
  })
);

async function resolveAccountCode(tx: any, companyId: string, code: string): Promise<string> {
  const acc = await tx.account.findFirst({ where: { companyId, code } });
  if (!acc) throw ApiError.badRequest(`Account ${code} not found. Configure the chart of accounts.`);
  return acc.id;
}

export default router;