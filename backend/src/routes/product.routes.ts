import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { asyncHandler, parsePagination } from "../utils/handlers";
import { validateBody } from "../middleware/validate";
import { requirePermission } from "../middleware/auth";
import { writeAudit } from "../services/audit.service";
import { AuditAction } from "@prisma/client";
import { d } from "../utils/money";

const router = Router();

const productSchema = z.object({
  sku: z.string().min(1),
  barcode: z.string().optional().nullable(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  markup: z.coerce.number().optional().nullable(),
  gp: z.coerce.number().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  brandId: z.string().optional().nullable(),
  unitOfMeasureId: z.string().optional().nullable(),
  purchaseUnit: z.string().optional().nullable(),
  stockUnit: z.string().optional().nullable(),
  salesUnit: z.string().optional().nullable(),
  packSize: z.coerce.number().optional().nullable(),
  alternateUnits: z.any().optional(),
  type: z.enum(["STOCK", "SERVICE", "NON_STOCK", "ASSET"]).optional(),
  costingMethod: z.enum(["WEIGHTED_AVERAGE", "FIFO", "STANDARD"]).optional(),
  costPrice: z.coerce.number().optional().nullable(),
  sellingPrice: z.coerce.number().optional().nullable(),
  wholesalePrice: z.coerce.number().optional().nullable(),
  retailPrice: z.coerce.number().optional().nullable(),
  specialPrice: z.coerce.number().optional().nullable(),
  taxRateId: z.string().optional().nullable(),
  reorderLevel: z.coerce.number().optional().nullable(),
  reorderQuantity: z.coerce.number().optional().nullable(),
  minimumStock: z.coerce.number().optional().nullable(),
  maximumStock: z.coerce.number().optional().nullable(),
  preferredSupplierId: z.string().optional().nullable(),
  serialRequired: z.boolean().optional(),
  batchRequired: z.boolean().optional(),
  expiryRequired: z.boolean().optional(),
  weight: z.coerce.number().optional().nullable(),
  length: z.coerce.number().optional().nullable(),
  width: z.coerce.number().optional().nullable(),
  height: z.coerce.number().optional().nullable(),
  allowNegative: z.boolean().optional(),
  isPosFeatured: z.boolean().optional(),
  posColor: z.string().optional().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
});

const categorySchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  parentId: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

// ===== CATEGORIES =====
router.get(
  "/categories",
  requirePermission("category.view"),
  asyncHandler(async (req, res) => {
    const items = await prisma.category.findMany({
      where: { companyId: req.user!.companyId },
      orderBy: { name: "asc" },
      include: { children: true },
    });
    res.json({ items });
  })
);

router.post(
  "/categories",
  requirePermission("category.edit"),
  validateBody(categorySchema),
  asyncHandler(async (req, res) => {
    const cat = await prisma.category.create({
      data: { companyId: req.user!.companyId, ...req.body },
    });
    res.status(201).json(cat);
  })
);

router.put(
  "/categories/:id",
  requirePermission("category.edit"),
  validateBody(categorySchema.partial()),
  asyncHandler(async (req, res) => {
    const cat = await prisma.category.findUnique({ where: { id: req.params.id as string } });
    if (!cat || cat.companyId !== req.user!.companyId) throw ApiError.notFound("Category not found");
    const updated = await prisma.category.update({ where: { id: cat.id }, data: req.body });
    res.json(updated);
  })
);

// ===== BRANDS =====
router.get(
  "/brands",
  requirePermission("category.view"),
  asyncHandler(async (req, res) => {
    const items = await prisma.brand.findMany({ where: { companyId: req.user!.companyId }, orderBy: { name: "asc" } });
    res.json({ items });
  })
);

router.post(
  "/brands",
  requirePermission("category.edit"),
  validateBody(z.object({ name: z.string().min(1), code: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const brand = await prisma.brand.create({ data: { companyId: req.user!.companyId, ...req.body } });
    res.status(201).json(brand);
  })
);

// ===== UNITS =====
router.get(
  "/units",
  requirePermission("category.view"),
  asyncHandler(async (req, res) => {
    const items = await prisma.unitOfMeasure.findMany({ where: { companyId: req.user!.companyId }, orderBy: { code: "asc" } });
    res.json({ items });
  })
);

router.post(
  "/units",
  requirePermission("category.edit"),
  validateBody(z.object({ code: z.string().min(1), name: z.string().min(1), isBase: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const unit = await prisma.unitOfMeasure.create({ data: { companyId: req.user!.companyId, ...req.body } });
    res.status(201).json(unit);
  })
);

// ===== PRODUCTS =====
router.get(
  "/",
  requirePermission("product.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const where: Prisma.ProductWhereInput = { companyId: req.user!.companyId };

    if (req.query.search as string) {
      const q = req.query.search as string;
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { sku: { contains: q, mode: "insensitive" } },
        { barcode: { contains: q, mode: "insensitive" } },
        { aliases: { some: { alias: { contains: q, mode: "insensitive" } } } },
      ];
    }
    if (req.query.categoryId as string) where.categoryId = req.query.categoryId as string;
    if (req.query.departmentId as string) where.departmentId = req.query.departmentId as string;
    if (req.query.brandId as string) where.brandId = req.query.brandId as string;
    if (req.query.status as string) where.status = req.query.status as any;

    const [total, items] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include: {
          department: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          unitOfMeasure: { select: { id: true, code: true, name: true } },
          taxRate: { select: { id: true, name: true, rate: true } },
          aliases: true,
          preferredSupplier: { select: { id: true, name: true } },
        },
        orderBy: [{ name: "asc" }],
        skip,
        take: pageSize,
      }),
    ]);

    // Include on-hand quantities
    const productIds = items.map((p) => p.id);
    const balAgg = await prisma.stockBalance.groupBy({
      by: ["productId"],
      where: { productId: { in: productIds }, warehouse: { branch: { companyId: req.user!.companyId } } },
      _sum: { onHand: true, reserved: true, value: true, averageCost: true },
    });
    const balMap = new Map(balAgg.map((b) => [b.productId, b._sum]));

    res.json({
      items: items.map((p) => ({
        ...p,
        stockOnHand: balMap.get(p.id)?.onHand ?? 0,
        reserved: balMap.get(p.id)?.reserved ?? 0,
        stockValue: balMap.get(p.id)?.value ?? 0,
        averageCost: balMap.get(p.id)?.averageCost ?? p.averageCost ?? 0,
      })),
      total,
      page,
      pageSize,
    });
  })
);

// Quick product search for POS (fast, lightweight)
router.get(
  "/search",
  requirePermission("product.view"),
  asyncHandler(async (req, res) => {
    const q = (req.query.q as string) ?? "";
    const branchId = (req.query.branchId as string) ?? req.user!.branchId ?? undefined;
    const where: Prisma.ProductWhereInput = { companyId: req.user!.companyId, status: "ACTIVE" };
    if (q) {
      where.OR = [
        { sku: { contains: q, mode: "insensitive" } },
        { barcode: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
      ];
    } else {
      where.isPosFeatured = true;
    }
    const products = await prisma.product.findMany({
      where,
      take: Math.min(50, parseInt(req.query.limit as string, 10) || 20),
      select: {
        id: true,
        sku: true,
        barcode: true,
        name: true,
        sellingPrice: true,
        wholesalePrice: true,
        retailPrice: true,
        costPrice: true,
        type: true,
        isPosFeatured: true,
        posColor: true,
      },
    });

    // branch-specific pricing
    let branchPrices: Record<string, { sellingPrice: Prisma.Decimal | null; wholesalePrice: Prisma.Decimal | null; retailPrice: Prisma.Decimal | null }> = {};
    if (branchId) {
      const configs = await prisma.productBranch.findMany({
        where: { branchId, productId: { in: products.map((p) => p.id) } },
        select: { productId: true, sellingPrice: true, wholesalePrice: true, retailPrice: true },
      });
      branchPrices = Object.fromEntries(configs.map((c) => [c.productId, c]));
    }

    res.json({
      items: products.map((p) => ({
        ...p,
        sellingPrice: branchPrices[p.id]?.sellingPrice ?? p.sellingPrice ?? 0,
        wholesalePrice: branchPrices[p.id]?.wholesalePrice ?? p.wholesalePrice ?? 0,
        retailPrice: branchPrices[p.id]?.retailPrice ?? p.retailPrice ?? 0,
      })),
    });
  })
);

router.get(
  "/barcode/:code",
  requirePermission("product.view"),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: {
        companyId: req.user!.companyId,
        OR: [{ barcode: req.params.code as string }, { sku: req.params.code as string }],
      },
    });
    if (!product) throw ApiError.notFound("Product not found");
    res.json(product);
  })
);

router.get(
  "/:id",
  requirePermission("product.view"),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id as string },
      include: {
        department: true,
        category: true,
        brand: true,
        unitOfMeasure: true,
        taxRate: true,
        aliases: true,
        suppliers: { include: { supplier: { select: { id: true, name: true, code: true } } } },
        branchConfigs: { include: { branch: { select: { id: true, name: true, code: true } } } },
        priceHistory: { orderBy: { changedAt: "desc" }, take: 20 },
      },
    });
    if (!product || product.companyId !== req.user!.companyId) throw ApiError.notFound("Product not found");

    const stockTotals = await prisma.stockBalance.aggregate({
      where: { productId: product.id, warehouse: { branch: { companyId: req.user!.companyId } } },
      _sum: { onHand: true, reserved: true, available: true, damaged: true, inTransit: true, value: true },
    });

    res.json({ ...product, stockTotals });
  })
);

router.post(
  "/",
  requirePermission("product.create"),
  validateBody(productSchema),
  asyncHandler(async (req, res) => {
    const existingSku = await prisma.product.findUnique({
      where: { companyId_sku: { companyId: req.user!.companyId, sku: req.body.sku } },
    });
    if (existingSku) throw ApiError.conflict(`SKU already exists: ${req.body.sku}`);

    const existingBarcode = req.body.barcode
      ? await prisma.product.findUnique({
          where: { companyId_barcode: { companyId: req.user!.companyId, barcode: req.body.barcode } },
        })
      : null;
    if (existingBarcode) throw ApiError.conflict(`Barcode already exists: ${req.body.barcode}`);

    const product = await prisma.product.create({
      data: {
        companyId: req.user!.companyId,
        ...req.body,
        costPrice: req.body.costPrice != null ? d(req.body.costPrice) : d(0),
        averageCost: d(0),
        markup: req.body.markup != null ? d(req.body.markup) : null,
        gp: req.body.gp != null ? d(req.body.gp) : null,
        sellingPrice: req.body.sellingPrice != null ? d(req.body.sellingPrice) : d(0),
        wholesalePrice: req.body.wholesalePrice != null ? d(req.body.wholesalePrice) : null,
        retailPrice: req.body.retailPrice != null ? d(req.body.retailPrice) : null,
        specialPrice: req.body.specialPrice != null ? d(req.body.specialPrice) : null,
        reorderLevel: req.body.reorderLevel != null ? d(req.body.reorderLevel) : d(0),
        reorderQuantity: req.body.reorderQuantity != null ? d(req.body.reorderQuantity) : d(0),
        minimumStock: req.body.minimumStock != null ? d(req.body.minimumStock) : d(0),
        maximumStock: req.body.maximumStock != null ? d(req.body.maximumStock) : null,
        createdById: req.user!.id,
      },
    });

    await writeAudit(prisma as any, {
      companyId: req.user!.companyId,
      branchId: req.user!.branchId,
      userId: req.user!.id,
      action: AuditAction.CREATE,
      entity: "PRODUCT",
      entityId: product.id,
      description: `Created product ${req.body.sku} - ${req.body.name}`,
    });
    res.status(201).json(product);
  })
);

router.put(
  "/:id",
  requirePermission("product.edit"),
  validateBody(productSchema.partial()),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findUnique({ where: { id: req.params.id as string } });
    if (!product || product.companyId !== req.user!.companyId) throw ApiError.notFound("Product not found");

    // Price change tracking
    const priceFields = ["costPrice", "sellingPrice", "wholesalePrice", "retailPrice", "specialPrice"] as const;
    const priceChanges = priceFields.filter((f) => req.body[f] !== undefined && req.body[f] !== null);

    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.product.update({
        where: { id: product.id },
        data: {
          ...req.body,
          ...(priceChanges.length
            ? Object.fromEntries(priceChanges.map((f) => [f, d(req.body[f])]))
            : {}),
        },
      });

      if (req.body.costPrice != null) {
        // Only affect average cost when there is no stock
        const stockQty = await tx.stockBalance.aggregate({
          where: { productId: product.id },
          _sum: { onHand: true },
        });
        const totalQty = d(stockQty._sum.onHand ?? 0);
        if (totalQty.isZero() || req.body.costPrice !== null) {
          await tx.product.update({
            where: { id: product.id },
            data: { averageCost: d(req.body.costPrice) },
          });
        }
      }

      // price history records
      if (priceChanges.length > 0) {
        await tx.productPriceHistory.createMany({
          data: priceChanges.map((f) => ({
            productId: product.id,
            field: f,
            oldValue: product[f],
            newValue: req.body[f],
            changedById: req.user!.id,
          })),
        });
      }
      return changed;
    });

    await writeAudit(prisma as any, {
      companyId: req.user!.companyId,
      branchId: req.user!.branchId,
      userId: req.user!.id,
      action: AuditAction.UPDATE,
      entity: "PRODUCT",
      entityId: product.id,
      description: "Updated product",
    });
    res.json(updated);
  })
);

// Branch-specific pricing
router.put(
  "/:id/branch-price",
  requirePermission("product.price_change"),
  validateBody(
    z.object({
      branchId: z.string(),
      sellingPrice: z.coerce.number().optional(),
      wholesalePrice: z.coerce.number().optional(),
      retailPrice: z.coerce.number().optional(),
      specialPrice: z.coerce.number().optional(),
      reorderLevel: z.coerce.number().optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findUnique({ where: { id: req.params.id as string } });
    if (!product || product.companyId !== req.user!.companyId) throw ApiError.notFound("Product not found");

    const existing = await prisma.productBranch.findUnique({
      where: { productId_branchId: { productId: product.id, branchId: req.body.branchId } },
    });
    const data = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => !["branchId"].includes(k))
    );
    const config = existing
      ? await prisma.productBranch.update({
          where: { id: existing.id },
          data,
        })
      : await prisma.productBranch.create({
          data: { productId: product.id, branchId: req.body.branchId, ...data },
        });

    await writeAudit(prisma as any, {
      companyId: req.user!.companyId,
      branchId: req.user!.branchId,
      userId: req.user!.id,
      action: AuditAction.PRICE_CHANGE,
      entity: "PRODUCT_PRICE",
      entityId: product.id,
      description: "Set branch-specific pricing",
      afterJson: data,
    });
    res.json(config);
  })
);

// Bulk price update
router.post(
  "/bulk/price-update",
  requirePermission("product.price_change"),
  validateBody(
    z.object({
      productIds: z.array(z.string()).min(1),
      field: z.enum(["sellingPrice", "wholesalePrice", "retailPrice", "costPrice"]),
      operation: z.enum(["set", "increase_percent"]),
      value: z.coerce.number(),
    })
  ),
  asyncHandler(async (req, res) => {
    const { productIds, field, operation, value } = req.body;
    await prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: { companyId: req.user!.companyId, id: { in: productIds } },
      });
      for (const p of products) {
        const oldVal: any = p[field as keyof typeof p];
        const base = oldVal != null ? d(oldVal as any) : d(0);
        const newVal = operation === "set" ? d(value) : base.mul(d(1).plus(d(value).div(100)));
        await tx.product.update({
          where: { id: p.id },
          data: { [field]: newVal },
        });
        await tx.productPriceHistory.create({
          data: { productId: p.id, field, oldValue: base, newValue: newVal, changedById: req.user!.id },
        });
      }
    });
    res.json({ success: true, updated: productIds.length });
  })
);

// Import template (returns CSV headers)
router.get(
  "/import/template",
  requirePermission("product.import"),
  asyncHandler(async (_req, res) => {
    const headers = [
      "sku", "barcode", "name", "description", "category", "brand", "unitOfMeasure",
      "costPrice", "sellingPrice", "wholesalePrice", "retailPrice", "taxType",
      "reorderLevel", "reorderQuantity", "minimumStock", "maximumStock",
    ];
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=products-import-template.csv");
    res.send(headers.join(",") + "\n");
  })
);

// CSV import (simple parser; validates in one transaction)
router.post(
  "/import",
  requirePermission("product.import"),
  asyncHandler(async (req, res) => {
    const { rows } = req.body as { rows: Array<Record<string, string>> };
    if (!Array.isArray(rows) || rows.length === 0) throw ApiError.badRequest("No rows provided");

    const errors: Array<{ row: number; error: string }> = [];
    let created = 0, updated = 0, skipped = 0;

    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        try {
          const sku = (r.sku ?? "").trim();
          if (!sku) throw new Error("SKU is required");

          // find or create category
          let categoryId: string | null = null;
          if (r.category) {
            const cat = await tx.category.findFirst({
              where: { companyId: req.user!.companyId, name: r.category.trim() },
            });
            if (cat) categoryId = cat.id;
            else {
              const newCat = await tx.category.create({
                data: { companyId: req.user!.companyId, code: r.category.trim().toUpperCase().replace(/\s+/g, "_"), name: r.category.trim() },
              });
              categoryId = newCat.id;
            }
          }

          let brandId: string | null = null;
          if (r.brand) {
            const brand = await tx.brand.findFirst({ where: { companyId: req.user!.companyId, name: r.brand.trim() } });
            if (brand) brandId = brand.id;
            else {
              const newBrand = await tx.brand.create({ data: { companyId: req.user!.companyId, name: r.brand.trim() } });
              brandId = newBrand.id;
            }
          }

          let unitId: string | null = null;
          if (r.unitOfMeasure) {
            const unit = await tx.unitOfMeasure.findFirst({
              where: { companyId: req.user!.companyId, code: r.unitOfMeasure.trim().toUpperCase() },
            });
            if (unit) unitId = unit.id;
            else {
              const newUnit = await tx.unitOfMeasure.create({
                data: { companyId: req.user!.companyId, code: r.unitOfMeasure.trim().toUpperCase(), name: r.unitOfMeasure.trim() },
              });
              unitId = newUnit.id;
            }
          }

          let taxRateId: string | null = null;
          if (r.taxType) {
            const rate = await tx.taxRate.findFirst({
              where: { companyId: req.user!.companyId, type: r.taxType.trim().toUpperCase().replace(" ", "_") },
            });
            if (rate) taxRateId = rate.id;
          }

          const existing = await tx.product.findUnique({
            where: { companyId_sku: { companyId: req.user!.companyId, sku } },
          });

          const data = {
            name: r.name?.trim() ?? existing?.name,
            description: r.description,
            categoryId,
            brandId,
            unitOfMeasureId: unitId,
            costPrice: r.costPrice ? d(r.costPrice) : undefined,
            averageCost: r.costPrice ? d(r.costPrice) : undefined,
            sellingPrice: r.sellingPrice ? d(r.sellingPrice) : undefined,
            wholesalePrice: r.wholesalePrice ? d(r.wholesalePrice) : undefined,
            retailPrice: r.retailPrice ? d(r.retailPrice) : undefined,
            taxRateId,
            reorderLevel: r.reorderLevel ? d(r.reorderLevel) : undefined,
            reorderQuantity: r.reorderQuantity ? d(r.reorderQuantity) : undefined,
            minimumStock: r.minimumStock ? d(r.minimumStock) : undefined,
            maximumStock: r.maximumStock ? d(r.maximumStock) : undefined,
          };

          if (existing) {
            await tx.product.update({ where: { id: existing.id }, data });
            updated++;
          } else {
            if (!data.name) throw new Error("Name is required for new products");
            await tx.product.create({
              data: {
                companyId: req.user!.companyId,
                sku,
                barcode: r.barcode || null,
                ...data,
                createdById: req.user!.id,
              },
            });
            created++;
          }
        } catch (err: any) {
          errors.push({ row: i + 2, error: err.message ?? "Unknown error" });
        }
      }
    });

    res.json({
      success: true,
      summary: { total: rows.length, created, updated, skipped, errors: errors.length },
      errors: errors.slice(0, 50),
    });
  })
);

export default router;