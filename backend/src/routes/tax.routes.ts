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

const router = Router();

router.get(
  "/rates",
  requirePermission("tax.view"),
  asyncHandler(async (req, res) => {
    const where: Prisma.TaxRateWhereInput = { companyId: req.user!.companyId };
    if (req.query.active as string !== undefined) where.isActive = req.query.active as string === "true";
    if (req.query.type as string) where.type = req.query.type as string;
    const items = await prisma.taxRate.findMany({
      where,
      orderBy: { name: "asc" },
    });
    res.json({ items });
  })
);

router.get(
  "/rates/:id",
  requirePermission("tax.view"),
  asyncHandler(async (req, res) => {
    const rate = await prisma.taxRate.findUnique({ where: { id: req.params.id as string } });
    if (!rate || rate.companyId !== req.user!.companyId) throw ApiError.notFound("Tax rate not found");
    res.json(rate);
  })
);

router.post(
  "/rates",
  requirePermission("tax.edit"),
  validateBody(z.object({
    name: z.string().min(1),
    rate: z.coerce.number().min(0).max(100),
    type: z.string().default("VAT"),
    isCompound: z.boolean().optional(),
    effectiveFrom: z.coerce.date().optional(),
  })),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const rate = await prisma.taxRate.create({
      data: { companyId, ...req.body },
    });
    await writeAudit(prisma as any, {
      companyId,
      userId: req.user!.id,
      action: AuditAction.CREATE,
      entity: "TAX_RATE",
      entityId: rate.id,
      afterJson: { name: rate.name, rate: rate.rate },
    });
    res.status(201).json(rate);
  })
);

router.put(
  "/rates/:id",
  requirePermission("tax.edit"),
  validateBody(z.object({
    name: z.string().optional(),
    rate: z.coerce.number().min(0).max(100).optional(),
    type: z.string().optional(),
    isCompound: z.boolean().optional(),
    isActive: z.boolean().optional(),
    effectiveTo: z.coerce.date().optional(),
  })),
  asyncHandler(async (req, res) => {
    const rate = await prisma.taxRate.findUnique({ where: { id: req.params.id as string } });
    if (!rate || rate.companyId !== req.user!.companyId) throw ApiError.notFound("Tax rate not found");
    const updated = await prisma.taxRate.update({ where: { id: rate.id }, data: req.body });
    res.json(updated);
  })
);

router.post(
  "/rates/:id/deactivate",
  requirePermission("tax.edit"),
  asyncHandler(async (req, res) => {
    const rate = await prisma.taxRate.findUnique({ where: { id: req.params.id as string } });
    if (!rate || rate.companyId !== req.user!.companyId) throw ApiError.notFound("Tax rate not found");
    const updated = await prisma.taxRate.update({
      where: { id: rate.id },
      data: { isActive: false, effectiveTo: new Date() },
    });
    res.json(updated);
  })
);

// CURRENCIES & EXCHANGE RATES

router.get(
  "/currencies",
  requirePermission("tax.view"),
  asyncHandler(async (req, res) => {
    const items = await prisma.currency.findMany({
      where: { companyId: req.user!.companyId },
      include: { exchangeRates: { orderBy: { effectiveDate: "desc" }, take: 1 } },
      orderBy: { code: "asc" },
    });
    res.json({ items });
  })
);

router.get(
  "/currencies/:id/exchange-rates",
  requirePermission("tax.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const currency = await prisma.currency.findUnique({ where: { id: req.params.id as string } });
    if (!currency || currency.companyId !== req.user!.companyId) throw ApiError.notFound("Currency not found");
    const [total, items] = await Promise.all([
      prisma.exchangeRate.count({ where: { currencyId: currency.id } }),
      prisma.exchangeRate.findMany({
        where: { currencyId: currency.id },
        orderBy: { effectiveDate: "desc" },
        skip,
        take: pageSize,
      }),
    ]);
    res.json({ items, total, page, pageSize });
  })
);

router.post(
  "/currencies/:id/exchange-rates",
  requirePermission("tax.edit"),
  validateBody(z.object({ rateToBase: z.coerce.number().positive(), effectiveDate: z.coerce.date().optional() })),
  asyncHandler(async (req, res) => {
    const currency = await prisma.currency.findUnique({ where: { id: req.params.id as string } });
    if (!currency || currency.companyId !== req.user!.companyId) throw ApiError.notFound("Currency not found");
    const er = await prisma.exchangeRate.create({
      data: { currencyId: currency.id, rateToBase: req.body.rateToBase, effectiveDate: req.body.effectiveDate },
    });
    res.status(201).json(er);
  })
);

router.get(
  "/exchange-rate",
  requirePermission("tax.view"),
  asyncHandler(async (req, res) => {
    const code = (req.query.code as string) ?? "USD";
    const currency = await prisma.currency.findFirst({
      where: { companyId: req.user!.companyId, code },
    });
    if (!currency) return res.json({ rate: 1, code, date: new Date() });
    const latest = await prisma.exchangeRate.findFirst({
      where: { currencyId: currency.id },
      orderBy: { effectiveDate: "desc" },
    });
    res.json({ rate: latest?.rateToBase ?? 1, code, date: latest?.effectiveDate ?? new Date() });
  })
);

export default router;