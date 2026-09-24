import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { asyncHandler, parsePagination } from "../utils/handlers";
import { validateBody } from "../middleware/validate";
import { requirePermission, effectiveBranchId } from "../middleware/auth";
import { writeAudit } from "../services/audit.service";
import { AuditAction } from "@prisma/client";
import { recordStockMovement } from "../services/inventory.service";
import { postJournal } from "../services/accounting.service";
import { getPostingAccounts } from "../services/postingAccounts.service";
import { nextReference } from "../services/sequence.service";
import { d, mul } from "../utils/money";
import { notifyBranchRoleUsers } from "../services/notification.service";

const router = Router();

// GET /api/inventory/stock — stock on hand with filters
router.get(
  "/stock",
  requirePermission("inventory.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const branchId = effectiveBranchId(req);
    const warehouseId = req.query.warehouseId as string | undefined;
    const productFilter: Prisma.ProductWhereInput = { companyId: req.user!.companyId };

    if (req.query.search as string) {
      const q = req.query.search as string;
      productFilter.OR = [
        { sku: { contains: q, mode: "insensitive" } },
        { barcode: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
      ];
    }

    const products = await prisma.product.findMany({
      where: productFilter,
      select: { id: true, sku: true, name: true, barcode: true, status: true },
      skip,
      take: pageSize,
      orderBy: { name: "asc" },
    });
    const productIds = products.map((p) => p.id);
    const total = await prisma.product.count({ where: productFilter });

    const whWhere: Prisma.StockBalanceWhereInput = { productId: { in: productIds } };
    if (warehouseId) whWhere.warehouseId = warehouseId;
    else if (branchId) whWhere.warehouse = { branchId };

    const balances = await prisma.stockBalance.findMany({
      where: whWhere,
      include: {
        warehouse: { select: { id: true, code: true, name: true, branch: { select: { id: true, name: true, code: true } } } },
        product: { select: { id: true, sku: true, name: true, barcode: true, reorderLevel: true, maximumStock: true, averageCost: true, sellingPrice: true } },
      },
      orderBy: { warehouse: { code: "asc" } },
    });

    res.json({ items: balances, total, page, pageSize });
  })
);

// Aggregated stock by product
router.get(
  "/stock/summary",
  requirePermission("inventory.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const branchId = effectiveBranchId(req);
    const productFilter: Prisma.ProductWhereInput = { companyId: req.user!.companyId };
    if (req.query.search as string) {
      const q = req.query.search as string;
      productFilter.OR = [
        { sku: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { barcode: { contains: q, mode: "insensitive" } },
      ];
    }
    if (req.query.lowStock as string === "true") productFilter.minimumStock = { gt: 0 };

    const products = await prisma.product.findMany({
      where: productFilter,
      select: { id: true, sku: true, name: true, barcode: true, reorderLevel: true, minimumStock: true, maximumStock: true, averageCost: true, sellingPrice: true, status: true },
      orderBy: { name: "asc" },
      skip,
      take: pageSize,
    });
    const total = await prisma.product.count({ where: productFilter });

    const groupBy = await prisma.stockBalance.groupBy({
      by: ["productId"],
      where: { productId: { in: products.map((p) => p.id) }, ...(branchId ? { warehouse: { branchId } } : {}) },
      _sum: { onHand: true, reserved: true, available: true, damaged: true, inTransit: true, value: true },
    });
    const map = new Map(groupBy.map((g) => [g.productId, g._sum]));

    res.json({
      items: products.map((p) => {
        const s = map.get(p.id);
        const onHand = d(s?.onHand ?? 0);
        return {
          ...p,
          onHand: onHand.toNumber(),
          reserved: d(s?.reserved ?? 0).toNumber(),
          available: d(s?.available ?? 0).toNumber(),
          damaged: d(s?.damaged ?? 0).toNumber(),
          inTransit: d(s?.inTransit ?? 0).toNumber(),
          stockValue: d(s?.value ?? 0).toNumber(),
          isLowStock: onHand.lessThanOrEqualTo(d(p.minimumStock ?? p.reorderLevel ?? 0)),
          isOverstock: p.maximumStock != null && onHand.greaterThan(d(p.maximumStock)),
        };
      }),
      total,
      page,
      pageSize,
    });
  })
);

// GET /api/inventory/movements — stock ledger
router.get(
  "/movements",
  requirePermission("inventory.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const where: Prisma.StockMovementWhereInput = { companyId: req.user!.companyId };
    const branchId = effectiveBranchId(req);
    if (!req.user!.canViewAllBranches && branchId) where.branchId = branchId;
    if (req.query.branchId as string) where.branchId = req.query.branchId as string;
    if (req.query.productId as string) where.productId = req.query.productId as string;
    if (req.query.type as string) where.type = req.query.type as any;
    if (req.query.from as string || req.query.to as string) {
      where.createdAt = {
        gte: req.query.from as string ? new Date(req.query.from as string) : undefined,
        lte: req.query.to as string ? new Date(new Date(req.query.to as string).getTime() + 86400000 - 1) : undefined,
      };
    }

    const [total, items] = await Promise.all([
      prisma.stockMovement.count({ where }),
      prisma.stockMovement.findMany({
        where,
        include: {
          product: { select: { id: true, sku: true, name: true } },
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

// ===== STOCK ADJUSTMENTS =====
const adjustmentSchema = z.object({
  branchId: z.string().optional(),
  warehouseId: z.string(),
  type: z.enum(["STOCK_ADJUSTMENT", "DAMAGE", "WRITE_OFF", "INTERNAL_CONSUMPTION"]).default("STOCK_ADJUSTMENT"),
  reason: z.string().min(3),
  lines: z.array(z.object({
    productId: z.string(),
    adjustment: z.coerce.number().nonnegative(),
    locationId: z.string().optional().nullable(),
    reason: z.string().optional(),
  })).min(1),
});

router.post(
  "/adjustments",
  requirePermission("inventory.adjust"),
  validateBody(adjustmentSchema),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = req.body.branchId ?? req.user!.branchId!;
    return prisma.$transaction(async (tx) => {
      const adjustmentReference = await nextReference({ companyId, branchId, docType: "STOCK_ADJUSTMENT" });
      const movementReference = await nextReference({ companyId, branchId, docType: "STOCK_ADJUSTMENT" });

      const postingAccounts = await getPostingAccounts(tx as any, companyId, branchId);
      const journalLines: any[] = [];

      const adjustment = await tx.stockAdjustment.create({
        data: {
          companyId,
          branchId,
          warehouseId: req.body.warehouseId,
          reference: adjustmentReference,
          type: req.body.type,
          note: req.body.reason,
          status: "POSTED",
          postedAt: new Date(),
          postedById: req.user!.id,
          createdById: req.user!.id,
        },
      });

      const lines: any[] = [];
      for (const l of req.body.lines) {
        const qty = d(l.adjustment);
        const product = await tx.product.findUnique({ where: { id: l.productId } });
        if (!product || product.companyId !== companyId) throw ApiError.badRequest("Invalid product");

        // Fetch current on-hand
        const current = await tx.stockBalance.findFirst({
          where: { productId: l.productId, warehouseId: req.body.warehouseId, locationId: l.locationId ?? null },
        });

        if (req.body.type === "DAMAGE" || req.body.type === "WRITE_OFF" || req.body.type === "INTERNAL_CONSUMPTION") {
          if (!current || d(current.onHand).lessThan(qty)) {
            throw ApiError.badRequest(`Insufficient stock for ${product.name} (${product.sku}). On hand: ${current?.onHand ?? 0}, adjustment: ${qty}`);
          }
        }

        const sign = req.body.type === "DAMAGE" || req.body.type === "WRITE_OFF" || req.body.type === "INTERNAL_CONSUMPTION" ? -1 : 1;
        const movement = await recordStockMovement(tx as any, {
          companyId,
          branchId,
          warehouseId: req.body.warehouseId,
          locationId: l.locationId,
          productId: l.productId,
          type: req.body.type,
          quantity: d(sign).mul(qty),
          unitCost: product.averageCost,
          reference: adjustmentReference,
          sourceType: "STOCK_ADJUSTMENT",
          sourceId: adjustment.id,
          userId: req.user!.id,
          note: l.reason ?? req.body.reason,
        });

        lines.push({
          adjustmentId: adjustment.id,
          productId: l.productId,
          locationId: l.locationId,
          quantityChange: d(sign).mul(qty),
          newOnHand: movement.newOnHand,
          reason: l.reason ?? req.body.reason,
          unitCost: movement.newAverageCost,
        });

        // GL: reduction to write-off account, increase to stock
        if (sign < 0) {
          journalLines.push({
            accountId: postingAccounts.stockWriteoffId,
            debit: mul(qty, movement.newAverageCost),
            description: `${req.body.type} ${product.sku} ${adjustmentReference}`,
          });
          journalLines.push({
            accountId: postingAccounts.inventoryId,
            credit: mul(qty, movement.newAverageCost),
            description: `Stock reduction ${product.sku}`,
          });
        } else {
          journalLines.push({
            accountId: postingAccounts.inventoryId,
            debit: mul(qty, movement.newAverageCost),
            description: `Stock increase ${product.sku}`,
          });
          journalLines.push({
            accountId: postingAccounts.stockWriteoffId,
            credit: mul(qty, movement.newAverageCost),
            description: `Adjustment ${product.sku}`,
          });
        }
      }

      await tx.stockAdjustmentLine.createMany({ data: lines as any });

      await postJournal(tx as any, {
        companyId,
        branchId,
        reference: `ADJ-${adjustmentReference}`,
        description: `Stock adjustment ${adjustmentReference} (${req.body.type})`,
        entryType: "ADJUSTMENT",
        sourceType: "STOCK_ADJUSTMENT",
        sourceId: adjustment.id,
        userId: req.user!.id,
        skipReference: true,
        lines: journalLines,
      });

      await writeAudit(tx as any, {
        companyId,
        branchId,
        userId: req.user!.id,
        action: AuditAction.STOCK_ADJUSTMENT,
        entity: "STOCK_ADJUSTMENT",
        entityId: adjustment.id,
        afterJson: { reference: adjustmentReference, lines: lines.length },
        description: `Stock adjustment ${adjustmentReference}`,
      });
      return { adjustment };
    }).then((r) => res.status(201).json(r));
  })
);

router.get(
  "/adjustments",
  requirePermission("inventory.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const where: Prisma.StockAdjustmentWhereInput = { companyId: req.user!.companyId };
    const branchId = effectiveBranchId(req);
    if (!req.user!.canViewAllBranches && branchId) where.branchId = branchId;
    const [total, items] = await Promise.all([
      prisma.stockAdjustment.count({ where }),
      prisma.stockAdjustment.findMany({
        where,
        include: {
          lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
    ]);
    res.json({ items, total, page, pageSize });
  })
);

// ===== STOCK COUNTS =====
const countSchema = z.object({
  branchId: z.string().optional(),
  warehouseId: z.string(),
  lines: z.array(z.object({
    productId: z.string(),
    countedQty: z.coerce.number().nonnegative(),
    locationId: z.string().optional().nullable(),
  })).min(1),
  note: z.string().optional(),
});

router.post(
  "/counts",
  requirePermission("inventory.count"),
  validateBody(countSchema),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = req.body.branchId ?? req.user!.branchId!;
    return prisma.$transaction(async (tx) => {
      const ref = await nextReference({ companyId, branchId, docType: "STOCK_COUNT" });

      const count = await tx.stockCount.create({
        data: {
          companyId,
          branchId,
          warehouseId: req.body.warehouseId,
          reference: ref,
          status: "POSTED",
          countedById: req.user!.id,
          note: req.body.note,
        },
      });

      const postingAccounts = await getPostingAccounts(tx as any, companyId, branchId);
      const journalLines: any[] = [];
      const countLines: any[] = [];
      const adjustmentRef = await nextReference({ companyId, branchId, docType: "STOCK_ADJUSTMENT" });

      for (const l of req.body.lines) {
        const product = await tx.product.findUnique({ where: { id: l.productId } });
        if (!product || product.companyId !== companyId) throw ApiError.badRequest("Invalid product");

        const current = await tx.stockBalance.findFirst({
          where: { productId: l.productId, warehouseId: req.body.warehouseId, locationId: l.locationId ?? null },
        });
        const systemQty = d(current?.onHand ?? 0);
        const countedQty = d(l.countedQty);
        const variance = countedQty.minus(systemQty);

        countLines.push({
          countId: count.id,
          productId: l.productId,
          locationId: l.locationId,
          systemQty,
          countedQty,
          variance,
          unitCost: product.averageCost,
        });

        if (!variance.isZero()) {
          const movement = await recordStockMovement(tx as any, {
            companyId,
            branchId,
            warehouseId: req.body.warehouseId,
            locationId: l.locationId,
            productId: l.productId,
            type: "STOCK_COUNT",
            quantity: variance,
            unitCost: product.averageCost,
            reference: ref,
            sourceType: "STOCK_COUNT",
            sourceId: count.id,
            userId: req.user!.id,
          });

          const val = mul(variance.abs(), movement.newAverageCost);
          if (variance.isNegative()) {
            journalLines.push({ accountId: postingAccounts.stockWriteoffId, debit: val, description: `Count variance ${product.sku}` });
            journalLines.push({ accountId: postingAccounts.inventoryId, credit: val, description: `Count variance ${product.sku}` });
          } else {
            journalLines.push({ accountId: postingAccounts.inventoryId, debit: val, description: `Count variance ${product.sku}` });
            journalLines.push({ accountId: postingAccounts.stockWriteoffId, credit: val, description: `Count variance ${product.sku}` });
          }
        }
      }

      await tx.stockCountLine.createMany({ data: countLines as any });

      if (journalLines.length > 0) {
        await postJournal(tx as any, {
          companyId,
          branchId,
          reference: `SC-${adjustmentRef}`,
          description: `Stock count variances ${ref}`,
          entryType: "ADJUSTMENT",
          sourceType: "STOCK_COUNT",
          sourceId: count.id,
          userId: req.user!.id,
          skipReference: true,
          lines: journalLines,
        });
      }

      await writeAudit(tx as any, {
        companyId,
        branchId,
        userId: req.user!.id,
        action: AuditAction.STOCK_ADJUSTMENT,
        entity: "STOCK_COUNT",
        entityId: count.id,
        afterJson: { reference: ref, lines: countLines.length },
        description: `Stock count ${ref} posted`,
      });
      return { count };
    }).then((r) => res.status(201).json(r));
  })
);

router.get(
  "/counts",
  requirePermission("inventory.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const where: Prisma.StockCountWhereInput = { companyId: req.user!.companyId };
    const branchId = effectiveBranchId(req);
    if (!req.user!.canViewAllBranches && branchId) where.branchId = branchId;
    const [total, items] = await Promise.all([
      prisma.stockCount.count({ where }),
      prisma.stockCount.findMany({
        where,
        include: {
          warehouse: { select: { id: true, name: true, code: true } },
          lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
        },
        orderBy: { countDate: "desc" },
        skip,
        take: pageSize,
      }),
    ]);
    res.json({ items, total, page, pageSize });
  })
);

// ===== BLOCKTESTS =====
const blocktestSchema = z.object({
  branchId: z.string().optional(),
  warehouseId: z.string().optional(),
  rawProductId: z.string(),
  carcassType: z.string(),
  rawWeight: z.coerce.number().nonnegative(),
  rawCost: z.coerce.number().nonnegative(),
  totalRevenue: z.coerce.number().nonnegative(),
  gpPerc: z.coerce.number(),
  markupPerc: z.coerce.number(),
  lines: z.array(z.object({
    productId: z.string().optional().nullable(),
    cutName: z.string(),
    yieldPerc: z.coerce.number(),
    estWeight: z.coerce.number(),
    estCost: z.coerce.number(),
    sellingPrice: z.coerce.number(),
    expectedRevenue: z.coerce.number(),
    gpPerc: z.coerce.number(),
  }))
});

router.post(
  "/blocktests",
  requirePermission("inventory.adjust"),
  validateBody(blocktestSchema),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = req.body.branchId ?? req.user!.branchId!;
    
    return prisma.$transaction(async (tx) => {
      // Find default warehouse if none specified
      let warehouseId = req.body.warehouseId;
      if (!warehouseId) {
        const wh = await tx.warehouse.findFirst({ where: { branchId, status: "ACTIVE" }});
        if (!wh) throw ApiError.badRequest("No active warehouse found for branch");
        warehouseId = wh.id;
      }
      
      const reference = await nextReference({ companyId, branchId, docType: "STOCK_ADJUSTMENT" });
      const postingAccounts = await getPostingAccounts(tx as any, companyId, branchId);
      
      const blocktest = await tx.blocktest.create({
        data: {
          companyId,
          branchId,
          warehouseId,
          reference: `BT-${reference}`,
          status: "POSTED",
          rawProductId: req.body.rawProductId,
          carcassType: req.body.carcassType,
          rawWeight: req.body.rawWeight,
          rawCost: req.body.rawCost,
          totalRevenue: req.body.totalRevenue,
          gpPerc: req.body.gpPerc,
          markupPerc: req.body.markupPerc,
          createdById: req.user!.id,
          postedAt: new Date(),
          postedById: req.user!.id,
        }
      });
      
      const journalLines: any[] = [];
      
      // Deduct Raw Material
      const rawProduct = await tx.product.findUnique({ where: { id: req.body.rawProductId }});
      if (rawProduct) {
        const movement = await recordStockMovement(tx as any, {
          companyId,
          branchId,
          warehouseId,
          productId: rawProduct.id,
          type: "BLOCKTEST_RAW_CONSUMPTION",
          quantity: d(-req.body.rawWeight),
          unitCost: rawProduct.averageCost,
          reference: blocktest.reference,
          sourceType: "BLOCKTEST",
          sourceId: blocktest.id,
          userId: req.user!.id,
          note: `Blocktest Raw Consumption`,
        });
        
        const costVal = mul(req.body.rawWeight, movement.newAverageCost);
        journalLines.push({
          accountId: postingAccounts.stockWriteoffId, // WIP or COGS in production
          debit: costVal,
          description: `Blocktest Raw ${rawProduct.sku}`,
        });
        journalLines.push({
          accountId: postingAccounts.inventoryId,
          credit: costVal,
          description: `Blocktest Stock Reduction ${rawProduct.sku}`,
        });
      }

      // Add Lines
      const linesData = [];
      for (const l of req.body.lines) {
        linesData.push({
          blocktestId: blocktest.id,
          productId: l.productId || null,
          cutName: l.cutName,
          yieldPerc: l.yieldPerc,
          estWeight: l.estWeight,
          estCost: l.estCost,
          sellingPrice: l.sellingPrice,
          expectedRevenue: l.expectedRevenue,
          gpPerc: l.gpPerc,
        });
        
        if (l.productId && l.estWeight > 0) {
           const p = await tx.product.findUnique({ where: { id: l.productId }});
           if (p) {
              const unitCost = l.estWeight > 0 ? d(l.estCost).div(l.estWeight).toNumber() : 0;
              const movement = await recordStockMovement(tx as any, {
                companyId,
                branchId,
                warehouseId,
                productId: p.id,
                type: "BLOCKTEST_CUT_PRODUCTION",
                quantity: d(l.estWeight),
                unitCost: d(unitCost),
                reference: blocktest.reference,
                sourceType: "BLOCKTEST",
                sourceId: blocktest.id,
                userId: req.user!.id,
                note: `Blocktest Production: ${l.cutName}`,
              });
              
              journalLines.push({
                accountId: postingAccounts.inventoryId,
                debit: d(l.estCost),
                description: `Blocktest Production ${p.sku}`,
              });
              journalLines.push({
                accountId: postingAccounts.stockWriteoffId,
                credit: d(l.estCost),
                description: `Blocktest Production offset ${p.sku}`,
              });
           }
        }
      }
      
      await tx.blocktestLine.createMany({ data: linesData });
      
      if (journalLines.length > 0) {
         await postJournal(tx as any, {
            companyId,
            branchId,
            reference: `JE-${blocktest.reference}`,
            description: `Blocktest conversion ${blocktest.reference}`,
            entryType: "ADJUSTMENT",
            sourceType: "BLOCKTEST",
            sourceId: blocktest.id,
            userId: req.user!.id,
            skipReference: true,
            lines: journalLines,
         });
      }

      return { blocktest };
    }).then((r) => res.status(201).json(r));
  })
);

router.get(
  "/blocktests",
  requirePermission("inventory.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const where: Prisma.BlocktestWhereInput = { companyId: req.user!.companyId };
    const branchId = effectiveBranchId(req);
    if (!req.user!.canViewAllBranches && branchId) where.branchId = branchId;
    
    const [total, items] = await Promise.all([
      prisma.blocktest.count({ where }),
      prisma.blocktest.findMany({
        where,
        include: {
           rawProduct: { select: { id: true, name: true, sku: true }},
           lines: { include: { product: { select: { id: true, name: true, sku: true } } } }
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
    ]);
    res.json({ items, total, page, pageSize });
  })
);

// Reorder point check
router.post(
  "/check-reorders",
  requirePermission("inventory.view"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const balances = await prisma.stockBalance.findMany({
      where: { warehouse: { branch: { companyId } }, product: { status: "ACTIVE", reorderLevel: { gt: 0 } } },
      include: {
        product: { select: { id: true, sku: true, name: true, reorderLevel: true, reorderQuantity: true } },
        warehouse: { select: { id: true, branchId: true, name: true } },
      },
    });
    const lowStock = balances
      .filter((b) => d(b.available).lessThanOrEqualTo(d(b.product.reorderLevel ?? 0)))
      .map((b) => ({
        product: b.product,
        warehouse: b.warehouse,
        available: d(b.available).toNumber(),
        suggestion: Math.max(0, d(b.product.reorderQuantity ?? 0).toNumber()),
      }));

    // Notify branch/inventory managers about low stock so they can act on it
    const byBranch = new Map<string, typeof lowStock>();
    for (const item of lowStock) {
      const bucket = byBranch.get(item.warehouse.branchId) ?? [];
      bucket.push(item);
      byBranch.set(item.warehouse.branchId, bucket);
    }
    for (const [branchKey, items] of byBranch) {
      const title = items.length === 1 ? "Low stock alert: 1 item below reorder level" : `Low stock alert: ${items.length} items below reorder level`;
      await notifyBranchRoleUsers(prisma as any, companyId, branchKey, ["Branch Manager", "Inventory Manager", "Warehouse Manager"], {
        type: "LOW_STOCK",
        title,
        message: items.map((i) => `${i.product.name} (${i.product.sku}): ${i.available} on hand`).slice(0, 5).join(", "),
        entityType: "PRODUCT",
        branchId: branchKey,
        priority: "HIGH",
      });
    }

    res.json({ items: lowStock, count: lowStock.length });
  })
);

export default router;