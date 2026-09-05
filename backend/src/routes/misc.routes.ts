import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { asyncHandler, parsePagination } from "../utils/handlers";
import { requirePermission, effectiveBranchId, branchMatchesUser } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { z } from "zod";
import { writeAudit } from "../services/audit.service";
import { AuditAction } from "@prisma/client";
import { d } from "../utils/money";

const router = Router();

// ==================== PAYMENT METHODS ====================

// Payment methods are typically configured via settings, but expose a read helper
router.get(
  "/payment-methods",
  requirePermission("pos.view"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const setting = await prisma.appSetting.findUnique({
      where: { companyId_group_key: { companyId, group: "POS", key: "payment_methods" } },
    });
    const methods = setting?.value
      ? setting.value.split(",").map((s) => s.trim()).filter(Boolean)
      : ["CASH", "CARD", "MOBILE_MONEY", "BANK_TRANSFER", "ECOCASH", "ONEMONEY", "CREDIT"];
    res.json({ items: methods });
  })
);

// ==================== POS SHIFTS ====================

router.get(
  "/pos-shifts",
  requirePermission("pos.shift_open"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const where: Prisma.POSShiftWhereInput = { companyId: req.user!.companyId };
    const branchId = effectiveBranchId(req);
    if (!req.user!.canViewAllBranches && branchId) where.branchId = branchId;
    if (req.query.status as string) where.status = req.query.status as string;
    if (req.query.cashierId as string) where.cashierId = req.query.cashierId as string;

    const [total, items] = await Promise.all([
      prisma.pOSShift.count({ where }),
      prisma.pOSShift.findMany({
        where,
        include: { cashier: { select: { id: true, fullName: true, username: true } } },
        orderBy: { openedAt: "desc" },
        skip,
        take: pageSize,
      }),
    ]);
    res.json({ items, total, page, pageSize });
  })
);

// Open a shift
router.post(
  "/pos-shifts/open",
  requirePermission("pos.shift_open"),
  validateBody(z.object({ terminal: z.string().optional().nullable(), openingFloat: z.coerce.number().min(0).default(0) })),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = req.user!.branchId!;
    if (!branchId) throw ApiError.badRequest("You must be assigned to a branch to open a shift");

    // Ensure no open shift for this cashier
    const existing = await prisma.pOSShift.findFirst({
      where: { companyId, cashierId: req.user!.id, status: "OPEN" },
    });
    if (existing) throw ApiError.badRequest("You already have an open shift");

    const shift = await prisma.pOSShift.create({
      data: {
        companyId,
        branchId,
        cashierId: req.user!.id,
        terminal: req.body.terminal,
        openingFloat: req.body.openingFloat,
        status: "OPEN",
        openedAt: new Date(),
      },
    });

    await prisma.pOSShiftEvent.create({
      data: { shiftId: shift.id, type: "OPEN", amount: req.body.openingFloat, createdById: req.user!.id, note: "Shift opened" },
    });

    return res.status(201).json(shift);
  })
);

// Get my open shift
router.get(
  "/pos-shifts/my-open",
  requirePermission("pos.shift_open"),
  asyncHandler(async (req, res) => {
    const shift = await prisma.pOSShift.findFirst({
      where: { companyId: req.user!.companyId, cashierId: req.user!.id, status: "OPEN" },
      include: {
        events: { orderBy: { createdAt: "asc" } },
        sales: {
          where: { status: { in: ["COMPLETED", "PARTIAL_RETURN"] } },
          select: { id: true, reference: true, total: true, saleDate: true, paymentMethod: true, payments: { select: { amount: true, paymentMethod: true } } },
        },
      },
    });
    if (!shift) return res.json({ shift: null });
    const cashSales = shift.sales.reduce((sum, sale) => sum.plus(
      sale.payments.filter((payment) => payment.paymentMethod === "CASH").reduce((value, payment) => value.plus(d(payment.amount)), d(0))
    ), d(0));
    const cashDrops = shift.events.filter((event) => event.type === "CASH_DROP").reduce((sum, event) => sum.plus(d(event.amount)), d(0));
    const expenses = shift.events.filter((event) => event.type === "EXPENSE").reduce((sum, event) => sum.plus(d(event.amount)), d(0));
    const expectedCash = d(shift.openingFloat).plus(cashSales).minus(cashDrops).minus(expenses);
    res.json({ shift, cashSummary: { cashSales: cashSales.toNumber(), cashDrops: cashDrops.toNumber(), expenses: expenses.toNumber(), expectedCash: expectedCash.toNumber() } });
  })
);

// Cash event on a shift (drop, up, declaration)
router.post(
  "/pos-shifts/:id/cash",
  requirePermission("pos.cash_manage"),
  validateBody(z.object({
    type: z.enum(["CASH_DROP", "CASH_UP", "DECLARATION"]),
    amount: z.coerce.number().min(0),
    method: z.string().optional(),
    note: z.string().optional(),
  })),
  asyncHandler(async (req, res) => {
    const shift = await prisma.pOSShift.findUnique({ where: { id: req.params.id as string } });
    if (!shift || shift.companyId !== req.user!.companyId) throw ApiError.notFound("Shift not found");
    if (shift.status !== "OPEN") throw ApiError.badRequest("Shift is not open");

    const event = await prisma.pOSShiftEvent.create({
      data: {
        shiftId: shift.id,
        type: req.body.type,
        amount: req.body.amount,
        method: req.body.method,
        note: req.body.note,
        createdById: req.user!.id,
      },
    });
    res.status(201).json(event);
  })
);

// Close a shift
router.post(
  "/pos-shifts/:id/close",
  requirePermission("pos.shift_open"),
  validateBody(z.object({
    countedCash: z.coerce.number().min(0),
    varianceNotes: z.string().optional(),
    expectedCash: z.coerce.number().optional(),
  })),
  asyncHandler(async (req, res) => {
    const shift = await prisma.pOSShift.findUnique({
      where: { id: req.params.id as string },
      include: { sales: { where: { status: { in: ["COMPLETED", "PARTIAL_RETURN"] } }, include: { payments: true } } },
    });
    if (!shift || shift.companyId !== req.user!.companyId) throw ApiError.notFound("Shift not found");
    if (!branchMatchesUser(req, shift.branchId)) throw ApiError.forbidden("You do not have access to this shift");
    if (shift.cashierId !== req.user!.id && !req.user!.permissions.has("pos.cash_manage")) throw ApiError.forbidden("Only the cashier or a cash manager can close this shift");
    if (shift.status !== "OPEN") throw ApiError.badRequest("Shift is not open");

    // Calculate expected cash: opening float + cash sales - cash drops/expenses
    const cashSales = shift.sales.reduce((acc, sale) => acc.plus(
      sale.payments.filter((payment) => payment.paymentMethod === "CASH").reduce((sum, payment) => sum.plus(d(payment.amount)), d(0))
    ), d(0));

    const events = await prisma.pOSShiftEvent.findMany({ where: { shiftId: shift.id } });
    const cashDrops = events
      .filter((e) => e.type === "CASH_DROP")
      .reduce((acc, e) => acc.plus(d(e.amount)), d(0));
    const expenses = events
      .filter((e) => e.type === "EXPENSE")
      .reduce((acc, e) => acc.plus(d(e.amount)), d(0));

    const expectedCash = d(shift.openingFloat).plus(cashSales).minus(cashDrops).minus(expenses);

    const countedCash = d(req.body.countedCash);
    const variance = countedCash.minus(expectedCash);

    const updated = await prisma.pOSShift.update({
      where: { id: shift.id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        countedCash: countedCash,
        expectedCash: expectedCash,
        variance: variance,
        varianceNotes: req.body.varianceNotes,
        closedById: req.user!.id,
      },
    });

    await prisma.pOSShiftEvent.create({
      data: {
        shiftId: shift.id,
        type: "DECLARATION",
        amount: countedCash,
        note: `Shift closed. Variance: ${variance}`,
        createdById: req.user!.id,
      },
    });

    res.json(updated);
  })
);

// ==================== HELD / SUSPENDED POS SALES ====================

router.get(
  "/pos-held",
  requirePermission("pos.held"),
  asyncHandler(async (req, res) => {
    const branchId = effectiveBranchId(req);
    const sales = await prisma.sale.findMany({
      where: {
        companyId: req.user!.companyId,
        status: "HELD",
        ...(!req.user!.canViewAllBranches && branchId ? { branchId } : {}),
      },
      include: {
        lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
      },
      orderBy: { saleDate: "desc" },
    });
    res.json({ items: sales });
  })
);

// Resume a held sale -> change to DRAFT/COMPLETED handled in sales routes

// ==================== COMPANY DIMENSIONS ====================

router.get(
  "/meta",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = effectiveBranchId(req);

    const [categories, brands, units, taxRates, paymentMethods, currencies] = await Promise.all([
      prisma.category.findMany({ where: { companyId, status: "ACTIVE" }, select: { id: true, name: true, code: true } }),
      prisma.brand.findMany({ where: { companyId, status: "ACTIVE" }, select: { id: true, name: true } }),
      prisma.unitOfMeasure.findMany({ where: { companyId }, select: { id: true, code: true, name: true } }),
      prisma.taxRate.findMany({ where: { companyId, isActive: true }, select: { id: true, name: true, rate: true } }),
      prisma.appSetting.findFirst({ where: { companyId, group: "POS", key: "payment_methods" } }),
      prisma.currency.findMany({ where: { companyId, isActive: true }, select: { id: true, code: true, name: true, symbol: true, isBase: true } }),
    ]);

    res.json({
      categories,
      brands,
      units,
      taxRates,
      paymentMethods: paymentMethods?.value?.split(",").filter(Boolean) ?? ["CASH", "CARD", "MOBILE_MONEY", "ECOCASH", "BANK_TRANSFER", "CREDIT"],
      currencies,
      branchId,
    });
  })
);

export default router;