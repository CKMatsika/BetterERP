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
import { postJournal } from "../services/accounting.service";
import { getPostingAccounts } from "../services/postingAccounts.service";
import { nextReference } from "../services/sequence.service";
import { d } from "../utils/money";

const router = Router();

const customerSchema = z.object({
  code: z.string().optional().nullable(),
  name: z.string().min(1),
  customerType: z.enum(["RETAIL", "WHOLESALE", "CONTRACT", "CREDIT"]).optional(),
  groupId: z.string().optional().nullable(),
  taxNumber: z.string().optional().nullable(),
  contactPerson: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  province: z.string().optional().nullable(),
  currency: z.string().optional(),
  creditLimit: z.coerce.number().optional().nullable(),
  creditApproved: z.boolean().optional(),
  paymentTerms: z.string().optional().nullable(),
  priceTier: z.string().optional().nullable(),
  branchId: z.string().optional().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
});

// GET /api/customers
router.get(
  "/",
  requirePermission("customer.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const where: Prisma.CustomerWhereInput = { companyId: req.user!.companyId };
    const branchId = effectiveBranchId(req);
    if (!req.user!.canViewAllBranches && branchId) where.branchId = branchId;
    if (req.query.branchId as string) where.branchId = req.query.branchId as string;
    if (req.query.customerType as string) where.customerType = req.query.customerType as string;
    if (req.query.search as string) {
      where.OR = [
        { name: { contains: req.query.search as string, mode: "insensitive" } },
        { code: { contains: req.query.search as string, mode: "insensitive" } },
        { phone: { contains: req.query.search as string, mode: "insensitive" } },
        { email: { contains: req.query.search as string, mode: "insensitive" } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        include: { group: true, _count: { select: { sales: true } } },
        orderBy: { name: "asc" },
        skip,
        take: pageSize,
      }),
    ]);

    // Receivable balances
    const customerIds = items.map((c) => c.id);
    const balances = await prisma.customerReceipt.groupBy({
      by: ["customerId"],
      where: { customerId: { in: customerIds } },
      _sum: { amount: true },
    });
    const paymentMap = new Map(balances.map((b) => [b.customerId, d(b._sum.amount ?? 0)]));

    const salesAgg = await prisma.sale.groupBy({
      by: ["customerId"],
      where: { customerId: { in: customerIds }, isCredit: true },
      _sum: { total: true, amountPaid: true },
    });
    const salesMap = new Map(salesAgg.map((s) => [s.customerId, s._sum]));

    res.json({
      items: items.map((c) => {
        const billed = d((salesMap.get(c.id)?.total as any) ?? 0);
        const paid = d((paymentMap.get(c.id) ?? 0));
        return {
          ...c,
          outstandingAmount: billed.minus(paid).toNumber(),
          totalCreditSales: billed.toNumber(),
        };
      }),
      total,
      page,
      pageSize,
    });
  })
);

router.get(
  "/groups",
  requirePermission("customer.view"),
  asyncHandler(async (req, res) => {
    const items = await prisma.customerGroup.findMany({ where: { companyId: req.user!.companyId } });
    res.json({ items });
  })
);

router.post(
  "/import",
  requirePermission("customer.create"),
  asyncHandler(async (req, res) => {
    const rows = req.body?.rows as Array<Record<string, string>>;
    if (!Array.isArray(rows) || rows.length === 0) throw ApiError.badRequest("No rows provided");
    const errors: Array<{ row: number; error: string }> = [];
    let created = 0; let updated = 0;
    await prisma.$transaction(async (tx) => {
      for (let index = 0; index < rows.length; index += 1) {
        try {
          const row = rows[index];
          if (!row.name?.trim()) throw new Error("Name is required");
          const existing = row.code ? await tx.customer.findFirst({ where: { companyId: req.user!.companyId, code: row.code.trim() } }) : null;
          const data = { name: row.name.trim(), customerType: row.customerType || "RETAIL", taxNumber: row.taxNumber || null, phone: row.phone || null, email: row.email || null, address: row.address || null, city: row.city || null, currency: row.currency || "USD", paymentTerms: row.paymentTerms || null, creditLimit: row.creditLimit ? d(row.creditLimit) : undefined, branchId: row.branchId || req.user!.branchId };
          if (existing) { await tx.customer.update({ where: { id: existing.id }, data }); updated += 1; }
          else { await tx.customer.create({ data: { companyId: req.user!.companyId, code: row.code || null, ...data } }); created += 1; }
        } catch (error) { errors.push({ row: index + 2, error: error instanceof Error ? error.message : "Invalid row" }); }
      }
    });
    res.json({ success: true, summary: { total: rows.length, created, updated, skipped: 0, errors: errors.length }, errors: errors.slice(0, 50) });
  })
);

router.post(
  "/groups",
  requirePermission("customer.edit"),
  validateBody(z.object({ name: z.string().min(1), discount: z.coerce.number().optional(), priceTier: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const group = await prisma.customerGroup.create({ data: { companyId: req.user!.companyId, ...req.body } });
    res.status(201).json(group);
  })
);

router.get(
  "/:id",
  requirePermission("customer.view"),
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id as string },
      include: {
        group: true,
        sales: { orderBy: { saleDate: "desc" }, take: 50, include: { lines: true, payments: true } },
        receipts: { orderBy: { receiptDate: "desc" }, take: 50 },
      },
    });
    if (!customer || customer.companyId !== req.user!.companyId) throw ApiError.notFound("Customer not found");
    if (!req.user!.canViewAllBranches && customer.branchId && customer.branchId !== req.user!.branchId) {
      throw ApiError.forbidden("You do not have access to this customer");
    }
    res.json(customer);
  })
);

router.post(
  "/",
  requirePermission("customer.create"),
  validateBody(customerSchema),
  asyncHandler(async (req, res) => {
    const branchId = req.body.branchId ?? req.user!.branchId;
    let reference = req.body.code;
    if (!reference) {
      reference = await nextReference({ companyId: req.user!.companyId, branchId, docType: "CUSTOMER" });
    }
    const customer = await prisma.customer.create({
      data: {
        companyId: req.user!.companyId,
        branchId,
        code: reference,
        ...req.body,
      },
    });
    await writeAudit(prisma as any, {
      companyId: req.user!.companyId,
      branchId,
      userId: req.user!.id,
      action: AuditAction.CREATE,
      entity: "CUSTOMER",
      entityId: customer.id,
      description: `Created customer ${customer.name}`,
    });
    res.status(201).json(customer);
  })
);

router.put(
  "/:id",
  requirePermission("customer.edit"),
  validateBody(customerSchema.partial()),
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findUnique({ where: { id: req.params.id as string } });
    if (!customer || customer.companyId !== req.user!.companyId) throw ApiError.notFound("Customer not found");
    const updated = await prisma.customer.update({ where: { id: customer.id }, data: req.body });
    await writeAudit(prisma as any, {
      companyId: req.user!.companyId,
      branchId: req.user!.branchId,
      userId: req.user!.id,
      action: AuditAction.UPDATE,
      entity: "CUSTOMER",
      entityId: customer.id,
      description: `Updated customer ${customer.name}`,
    });
    res.json(updated);
  })
);

// ===== Customer receipts (AR / payments received) =====
const receiptSchema = z.object({
  customerId: z.string(),
  invoiceId: z.string().optional().nullable(),
  amount: z.coerce.number().positive(),
  paymentMethod: z.string().default("CASH"),
  bankAccountId: z.string().optional().nullable(),
  receiptDate: z.coerce.date().optional(),
  notes: z.string().optional().nullable(),
  branchId: z.string().optional(),
});

router.post(
  "/receipts",
  requirePermission("sale.credit"),
  validateBody(receiptSchema),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = req.body.branchId ?? req.user!.branchId!;
    const result = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: req.body.customerId } });
      if (!customer || customer.companyId !== companyId) throw ApiError.notFound("Customer not found");
      let allocatedSale: { id: string; total: Prisma.Decimal; amountPaid: Prisma.Decimal } | null = null;
      if (req.body.invoiceId) {
        const sale = await tx.sale.findUnique({ where: { id: req.body.invoiceId } });
        if (!sale || sale.companyId !== companyId || sale.customerId !== customer.id || !sale.isCredit) throw ApiError.badRequest("Credit invoice does not belong to this customer");
        const allocated = await tx.customerReceipt.aggregate({ where: { invoiceId: sale.id, companyId }, _sum: { amount: true } });
        const invoiceOutstanding = d(sale.total).minus(d(allocated._sum.amount ?? 0));
        if (d(req.body.amount).greaterThan(invoiceOutstanding)) throw ApiError.badRequest("Receipt exceeds the invoice outstanding balance");
        allocatedSale = { id: sale.id, total: sale.total, amountPaid: sale.amountPaid };
      }
      const [creditSales, receipts] = await Promise.all([
        tx.sale.aggregate({ where: { customerId: customer.id, companyId, isCredit: true, status: { in: ["COMPLETED", "PARTIAL_RETURN"] } }, _sum: { total: true } }),
        tx.customerReceipt.aggregate({ where: { customerId: customer.id, companyId }, _sum: { amount: true } }),
      ]);
      const outstanding = d(creditSales._sum.total ?? 0).minus(d(receipts._sum.amount ?? 0));
      if (!allocatedSale && d(req.body.amount).greaterThan(outstanding)) throw ApiError.badRequest("Receipt exceeds the customer's outstanding balance");

      const reference = await nextReference({ companyId, branchId, docType: "RECEIPT" });
      const receipt = await tx.customerReceipt.create({
        data: {
          companyId,
          branchId,
          customerId: customer.id,
          reference,
          amount: d(req.body.amount),
          paymentMethod: req.body.paymentMethod,
          bankAccountId: req.body.bankAccountId,
          invoiceId: req.body.invoiceId,
          notes: req.body.notes,
          receiptDate: req.body.receiptDate ?? new Date(),
          posted: true,
          postedAt: new Date(),
        },
      });

      const accounts = await getPostingAccounts(tx as any, companyId, branchId);
      const pmMethod = req.body.paymentMethod.toUpperCase();
      const pmAccount =
        pmMethod === "BANK" || pmMethod === "ZIPIT" || pmMethod === "BANK_TRANSFER"
          ? accounts.bankAccountId
          : accounts.cashAccountId;

      await postJournal(tx as any, {
        companyId,
        branchId,
        reference: `REC-${reference}`,
        description: `Customer payment received ${reference}`,
        entryType: "RECEIPT",
        sourceType: "CUSTOMER_RECEIPT",
        sourceId: receipt.id,
        userId: req.user!.id,
        skipReference: true,
        lines: [
          { accountId: pmAccount, debit: d(req.body.amount), description: `Receipt ${reference}` },
          { accountId: accounts.arTradeId, credit: d(req.body.amount), description: `Receipt ${reference} applied to AR` },
        ],
      });

      if (allocatedSale) {
        await tx.sale.update({ where: { id: allocatedSale.id }, data: { amountPaid: d(allocatedSale.amountPaid).plus(d(req.body.amount)) } });
      }

      await writeAudit(tx as any, {
        companyId,
        branchId,
        userId: req.user!.id,
        action: AuditAction.POST,
        entity: "CUSTOMER_RECEIPT",
        entityId: receipt.id,
        afterJson: { reference, amount: req.body.amount },
        description: `Receipt ${reference} for ${customer.name}`,
      });
      return receipt;
    });
    res.status(201).json(result);
  })
);

// GET /api/customers/receipts (list)
router.get(
  "/receipts/list",
  requirePermission("customer.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const where: Prisma.CustomerReceiptWhereInput = { companyId: req.user!.companyId };
    const branchId = effectiveBranchId(req);
    if (!req.user!.canViewAllBranches && branchId) where.branchId = branchId;
    if (req.query.customerId as string) where.customerId = req.query.customerId as string;
    if (req.query.from as string || req.query.to as string) {
      where.receiptDate = {
        gte: req.query.from as string ? new Date(req.query.from as string) : undefined,
        lte: req.query.to as string ? new Date(new Date(req.query.to as string).getTime() + 86400000 - 1) : undefined,
      };
    }
    const [total, items] = await Promise.all([
      prisma.customerReceipt.count({ where }),
      prisma.customerReceipt.findMany({
        where,
        include: { customer: { select: { id: true, name: true, code: true } } },
        orderBy: { receiptDate: "desc" },
        skip,
        take: pageSize,
      }),
    ]);
    res.json({ items, total, page, pageSize });
  })
);

// Customer statement
router.get(
  "/:id/statement",
  requirePermission("report.view"),
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findUnique({ where: { id: req.params.id as string } });
    if (!customer || customer.companyId !== req.user!.companyId) throw ApiError.notFound("Customer not found");

    const from = req.query.from as string ? new Date(req.query.from as string) : new Date(0);
    const to = req.query.to as string ? new Date(new Date(req.query.to as string).getTime() + 86400000 - 1) : new Date(2999, 11, 31);

    const [sales, receipts, creditNotes] = await Promise.all([
      prisma.sale.findMany({
        where: { customerId: customer.id, isCredit: true, saleDate: { gte: from, lte: to } },
        orderBy: { saleDate: "asc" },
        select: { id: true, reference: true, saleDate: true, total: true, status: true },
      }),
      prisma.customerReceipt.findMany({
        where: { customerId: customer.id, receiptDate: { gte: from, lte: to } },
        orderBy: { receiptDate: "asc" },
        select: { id: true, reference: true, receiptDate: true, amount: true },
      }),
      prisma.saleReturn.findMany({
        where: { customerId: customer.id, returnDate: { gte: from, lte: to }, status: "POSTED" },
        orderBy: { returnDate: "asc" },
        select: { id: true, reference: true, returnDate: true, refundAmount: true },
      }),
    ]);

    interface StatementRow {
      date: Date;
      reference: string;
      type: string;
      debit: number;
      credit: number;
      balance: number;
    }

    const rows: StatementRow[] = [];
    let balance = d(0);
    for (const s of sales) {
      balance = balance.plus(s.total);
      rows.push({ date: s.saleDate, reference: s.reference, type: "INVOICE", debit: d(s.total).toNumber(), credit: 0, balance: balance.toNumber() });
    }
    for (const r of receipts) {
      balance = balance.minus(r.amount);
      rows.push({ date: r.receiptDate, reference: r.reference, type: "PAYMENT", debit: 0, credit: d(r.amount).toNumber(), balance: balance.toNumber() });
    }
    for (const cr of creditNotes) {
      balance = balance.minus(cr.refundAmount);
      rows.push({ date: cr.returnDate, reference: cr.reference, type: "CREDIT NOTE", debit: 0, credit: d(cr.refundAmount).toNumber(), balance: balance.toNumber() });
    }
    rows.sort((a, b) => a.date.getTime() - b.date.getTime());

    res.json({ customer, rows, closingBalance: balance.toNumber() });
  })
);

// Customer ageing
router.get(
  "/:id/ageing",
  requirePermission("report.view"),
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findUnique({ where: { id: req.params.id as string } });
    if (!customer || customer.companyId !== req.user!.companyId) throw ApiError.notFound("Customer not found");
    const today = new Date();
    const buckets = [
      { label: "Current", min: -Infinity, max: 30 },
      { label: "31-60 days", min: 30, max: 60 },
      { label: "61-90 days", min: 60, max: 90 },
      { label: "Over 90 days", min: 90, max: Infinity },
    ];
    const sales = await prisma.sale.findMany({
      where: { customerId: customer.id, isCredit: true, status: { notIn: ["CANCELLED", "VOID"] } },
      select: { total: true, amountPaid: true, saleDate: true },
    });
    const receipts = await prisma.customerReceipt.aggregate({
      where: { customerId: customer.id },
      _sum: { amount: true },
    });

    const totalPaid = d(receipts._sum.amount ?? 0);
    let remaining = sales.reduce((acc, s) => acc.plus(d(s.total)), d(0)).minus(totalPaid);

    const result = buckets.map((b) => {
      const outstanding = sales
        .filter((s) => {
          const age = today.getTime() - s.saleDate.getTime();
          const ageDays = age / 86400000;
          return ageDays >= b.min && ageDays < b.max;
        })
        .reduce((acc, s) => acc.plus(d(s.total)), d(0));
      return { label: b.label, amount: outstanding.toNumber() };
    });
    // Apply payments proportionally to oldest first is complex; report gross buckets
    res.json({ customer, buckets: result, totalOutstanding: remaining.toNumber() });
  })
);

export default router;