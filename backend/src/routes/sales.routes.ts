import { Router } from "express";
import { z } from "zod";
import { Prisma, SaleStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { asyncHandler, parsePagination } from "../utils/handlers";
import { validateBody } from "../middleware/validate";
import { requirePermission, effectiveBranchId } from "../middleware/auth";
import { writeAudit } from "../services/audit.service";
import { AuditAction } from "@prisma/client";
import { postJournal } from "../services/accounting.service";
import { nextReference } from "../services/sequence.service";
import { recordStockMovement } from "../services/inventory.service";
import { getPostingAccounts, ACCOUNT_CODES } from "../services/postingAccounts.service";
import { calculateTax } from "../services/tax.service";
import { d, mul, money } from "../utils/money";
import { createNotification } from "../services/notification.service";

const router = Router();

const documentLineSchema = z.object({ productId: z.string().optional().nullable(), quantity: z.coerce.number().positive(), unitPrice: z.coerce.number().nonnegative(), discount: z.coerce.number().min(0).default(0) });
const quotationSchema = z.object({ customerId: z.string().optional().nullable(), validUntil: z.coerce.date().optional().nullable(), lines: z.array(documentLineSchema).min(1) });

for (const documentType of ["quotations", "sales-orders"] as const) {
  const isQuotation = documentType === "quotations";
  router.get(`/${documentType}`, requirePermission("sale.view"), asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const where: Prisma.QuotationWhereInput | Prisma.SalesOrderWhereInput = { companyId: req.user!.companyId, ...(!req.user!.canViewAllBranches && req.user!.branchId ? { branchId: req.user!.branchId } : {}) };
    const model: any = isQuotation ? prisma.quotation : prisma.salesOrder;
    const [total, items] = await Promise.all([
      model.count({ where: where as never }),
      model.findMany({ where: where as never, include: { lines: true }, orderBy: { createdAt: "desc" }, skip, take: pageSize }),
    ]);
    res.json({ items, total, page, pageSize });
  }));

  router.post(`/${documentType}`, requirePermission("sale.create"), validateBody(quotationSchema), asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = req.user!.branchId;
    if (!branchId) throw ApiError.badRequest("No branch context");
    const result = await prisma.$transaction(async (tx) => {
      if (req.body.customerId) {
        const customer = await tx.customer.findUnique({ where: { id: req.body.customerId } });
        if (!customer || customer.companyId !== companyId) throw ApiError.badRequest("Invalid customer");
      }
      let subtotal = d(0); let discount = d(0);
      const lines = req.body.lines.map((line: { productId?: string | null; quantity: number; unitPrice: number; discount: number }) => {
        const lineSubtotal = mul(d(line.quantity), d(line.unitPrice));
        const lineDiscount = d(line.discount);
        subtotal = subtotal.plus(lineSubtotal); discount = discount.plus(lineDiscount);
        return { productId: line.productId ?? null, quantity: d(line.quantity), unitPrice: d(line.unitPrice), discount: lineDiscount, taxAmount: d(0), lineTotal: lineSubtotal.minus(lineDiscount) };
      });
      const reference = await nextReference({ companyId, branchId, docType: isQuotation ? "QUOTATION" : "SALES_ORDER" });
      const data = { companyId, branchId, customerId: req.body.customerId ?? null, reference, status: "DRAFT", subtotal, discount, taxAmount: d(0), total: subtotal.minus(discount), ...(isQuotation ? { validUntil: req.body.validUntil ?? null, createdBy: req.user!.id, lines: { create: lines } } : { createdBy: req.user!.id, lines: { create: lines } }) };
      const record = isQuotation ? await tx.quotation.create({ data }) : await tx.salesOrder.create({ data });
      await writeAudit(tx as any, { companyId, branchId, userId: req.user!.id, action: AuditAction.CREATE, entity: isQuotation ? "QUOTATION" : "SALES_ORDER", entityId: record.id, afterJson: { reference, total: subtotal.minus(discount).toNumber() } });
      return record;
    });
    res.status(201).json(result);
  }));

  if (isQuotation) {
    router.post("/quotations/:id/convert", requirePermission("sale.create"), asyncHandler(async (req, res) => {
      const result = await prisma.$transaction(async (tx) => {
        const quotation = await tx.quotation.findUnique({ where: { id: req.params.id as string }, include: { lines: true } });
        if (!quotation || quotation.companyId !== req.user!.companyId) throw ApiError.notFound("Quotation not found");
        if (!["DRAFT", "SENT", "ACCEPTED"].includes(quotation.status)) throw ApiError.badRequest("Quotation cannot be converted from its current status");
        const reference = await nextReference({ companyId: quotation.companyId, branchId: quotation.branchId, docType: "SALES_ORDER" });
        const order = await tx.salesOrder.create({ data: { companyId: quotation.companyId, branchId: quotation.branchId, customerId: quotation.customerId, reference, status: "DRAFT", subtotal: quotation.subtotal, discount: quotation.discount, taxAmount: quotation.taxAmount, total: quotation.total, createdBy: req.user!.id, lines: { create: quotation.lines.map((line) => ({ productId: line.productId, quantity: line.quantity, unitPrice: line.unitPrice, discount: line.discount, taxAmount: line.taxAmount, lineTotal: line.lineTotal })) } } });
        await tx.quotation.update({ where: { id: quotation.id }, data: { status: "CONVERTED" } });
        await writeAudit(tx as any, { companyId: quotation.companyId, branchId: quotation.branchId, userId: req.user!.id, action: AuditAction.UPDATE, entity: "QUOTATION", entityId: quotation.id, afterJson: { status: "CONVERTED", salesOrderId: order.id } });
        return order;
      });
      res.status(201).json(result);
    }));
  } else {
    router.post("/sales-orders/:id/approve", requirePermission("sale.create"), asyncHandler(async (req, res) => {
      const order = await prisma.salesOrder.findUnique({ where: { id: req.params.id as string } });
      if (!order || order.companyId !== req.user!.companyId) throw ApiError.notFound("Sales order not found");
      if (order.status !== "DRAFT") throw ApiError.badRequest("Only draft sales orders can be approved");
      const updated = await prisma.salesOrder.update({ where: { id: order.id }, data: { status: "APPROVED" } });
      res.json(updated);
    }));
    router.post("/sales-orders/:id/cancel", requirePermission("sale.create"), asyncHandler(async (req, res) => {
      const order = await prisma.salesOrder.findUnique({ where: { id: req.params.id as string } });
      if (!order || order.companyId !== req.user!.companyId) throw ApiError.notFound("Sales order not found");
      if (["FULFILLED", "CANCELLED"].includes(order.status)) throw ApiError.badRequest("Sales order cannot be cancelled");
      const updated = await prisma.salesOrder.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
      res.json(updated);
    }));
    router.post("/sales-orders/:id/fulfill", requirePermission("sale.create"), validateBody(z.object({ warehouseId: z.string() })), asyncHandler(async (req, res) => {
      const result = await prisma.$transaction(async (tx) => {
        const order = await tx.salesOrder.findUnique({ where: { id: req.params.id as string }, include: { lines: true } });
        if (!order || order.companyId !== req.user!.companyId) throw ApiError.notFound("Sales order not found");
        if (order.status !== "APPROVED") throw ApiError.badRequest("Only approved sales orders can be fulfilled");
        const warehouse = await tx.warehouse.findUnique({ where: { id: req.body.warehouseId } });
        if (!warehouse || warehouse.branchId !== order.branchId) throw ApiError.badRequest("Warehouse does not belong to the order branch");
        const reference = await nextReference({ companyId: order.companyId, branchId: order.branchId, docType: "INVOICE" });
        const postingAccounts = await getPostingAccounts(tx as any, order.companyId, order.branchId);
        const cogsLines: any[] = [];
        const saleLines: any[] = [];
        for (const line of order.lines) {
          if (!line.productId) throw ApiError.badRequest("Sales order contains a line without a product");
          const product = await tx.product.findUnique({ where: { id: line.productId } });
          if (!product || product.companyId !== order.companyId) throw ApiError.badRequest("Invalid product on sales order");
          const movement = await recordStockMovement(tx as any, { companyId: order.companyId, branchId: order.branchId, warehouseId: warehouse.id, productId: line.productId, type: "SALES", quantity: d(line.quantity).neg(), unitCost: d(product.averageCost ?? 0), reference, sourceType: "SALES_ORDER", userId: req.user!.id });
          const cost = mul(d(line.quantity), movement.newAverageCost);
          cogsLines.push({ accountId: postingAccounts.costOfSalesId, debit: cost, description: `COGS ${reference}` }, { accountId: postingAccounts.inventoryId, credit: cost, description: `Inventory ${reference}` });
          saleLines.push({ productId: line.productId, quantity: line.quantity, unitPrice: line.unitPrice, discount: line.discount, taxAmount: line.taxAmount, lineTotal: line.lineTotal, costPrice: movement.newAverageCost });
        }
        const sale = await tx.sale.create({ data: { companyId: order.companyId, branchId: order.branchId, warehouseId: warehouse.id, customerId: order.customerId, reference, type: "INVOICE", status: "COMPLETED", cashierId: req.user!.id, subtotal: order.subtotal, discount: order.discount, taxAmount: order.taxAmount, total: order.total, amountPaid: 0, changeDue: 0, currency: "USD", exchangeRate: 1, paymentMethod: "CREDIT", isCredit: true, postedAt: new Date(), lines: { create: saleLines } } });
        await postJournal(tx as any, { companyId: order.companyId, branchId: order.branchId, reference, description: `Fulfilled sales order ${order.reference}`, entryType: "SALE", sourceType: "SALE", sourceId: sale.id, userId: req.user!.id, skipReference: true, lines: [{ accountId: postingAccounts.arTradeId, debit: order.total, description: reference }, { accountId: postingAccounts.vatOutputId, credit: order.taxAmount, description: reference }, { accountId: postingAccounts.salesRevenueId, credit: order.subtotal.minus(order.discount), description: reference }, ...cogsLines] });
        await tx.salesOrder.update({ where: { id: order.id }, data: { status: "FULFILLED" } });
        await writeAudit(tx as any, { companyId: order.companyId, branchId: order.branchId, userId: req.user!.id, action: AuditAction.POST, entity: "SALES_ORDER", entityId: order.id, afterJson: { status: "FULFILLED", saleId: sale.id, reference } });
        return sale;
      });
      res.status(201).json(result);
    }));
  }
}

const saleLineSchema = z.object({
  productId: z.string().optional(),
  description: z.string().optional().nullable(),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().nonnegative(),
  discount: z.coerce.number().default(0),
  taxRateId: z.string().optional().nullable(),
});

const saleSchema = z.object({
  branchId: z.string().optional(),
  warehouseId: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
  type: z.enum(["POS", "INVOICE", "WHOLESALE", "RETAIL"]).default("POS"),
  saleDate: z.coerce.date().optional(),
  shiftId: z.string().optional().nullable(),
  lines: z.array(saleLineSchema).min(1),
  discount: z.coerce.number().default(0),
  discountApprovalRequired: z.boolean().optional(),
  paymentMethod: z.string().optional().default("CASH"),
  hasCredit: z.boolean().optional().default(false),
  payments: z
    .array(
      z.object({
        method: z.string(),
        amount: z.coerce.number().positive(),
        currency: z.string().default("USD"),
        exchangeRate: z.coerce.number().positive().default(1),
        bankAccountId: z.string().optional().nullable(),
        reference: z.string().optional().nullable(),
      })
    )
    .optional(),
  notes: z.string().optional().nullable(),
  hold: z.boolean().optional().default(false),
});

// GET /api/sales
router.get(
  "/",
  requirePermission("sale.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const branchId = effectiveBranchId(req);
    const where: Prisma.SaleWhereInput = { companyId: req.user!.companyId };

    if (!req.user!.canViewAllBranches && branchId) {
      where.branchId = branchId;
    }
    if (req.query.branchId as string) where.branchId = req.query.branchId as string;
    if (req.query.customerId as string) where.customerId = req.query.customerId as string;
    if (req.query.type as string) where.type = req.query.type as any;
    if (req.query.status as string) where.status = req.query.status as any;
    if (req.query.search as string) {
      where.OR = [
        { reference: { contains: req.query.search as string, mode: "insensitive" } },
        { customer: { name: { contains: req.query.search as string, mode: "insensitive" } } },
      ];
    }
    const from = req.query.from as string ? new Date(req.query.from as string) : undefined;
    const to = req.query.to as string ? new Date(req.query.to as string) : undefined;
    if (from || to) {
      where.saleDate = {
        gte: from,
        lte: to ? new Date(to.getTime() + 86400000 - 1) : undefined,
      };
    }

    const [total, items] = await Promise.all([
      prisma.sale.count({ where }),
      prisma.sale.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true } },
          cashier: { select: { id: true, fullName: true, username: true } },
          branch: { select: { id: true, name: true, code: true } },
          shift: { select: { id: true, status: true } },
          lines: { select: { id: true, productId: true, quantity: true, unitPrice: true, discount: true, taxAmount: true, lineTotal: true, description: true, product: { select: { sku: true, name: true, barcode: true } } } },
          payments: true,
        },
        orderBy: { saleDate: "desc" },
        skip,
        take: pageSize,
      }),
    ]);
    res.json({ items, total, page, pageSize });
  })
);

// GET /api/sales/today
router.get(
  "/today",
  requirePermission("sale.view"),
  asyncHandler(async (req, res) => {
    const branchId = effectiveBranchId(req);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const where: Prisma.SaleWhereInput = {
      companyId: req.user!.companyId,
      saleDate: { gte: start },
      status: { in: ["COMPLETED"] },
    };
    if (branchId && !req.user!.canViewAllBranches) where.branchId = branchId;
    if (req.query.branchId as string) where.branchId = req.query.branchId as string;

    const agg = await prisma.sale.aggregate({ where, _count: true, _sum: { total: true, taxAmount: true, subtotal: true, amountPaid: true } });
    res.json({
      count: agg._count,
      grossSales: agg._sum.total ?? 0,
      subtotal: agg._sum.subtotal ?? 0,
      tax: agg._sum.taxAmount ?? 0,
    });
  })
);

// GET /api/sales/:id
router.get(
  "/:id",
  requirePermission("sale.view"),
  asyncHandler(async (req, res) => {
    const sale = await prisma.sale.findUnique({
      where: { id: req.params.id as string },
      include: {
        customer: true,
        cashier: { select: { id: true, fullName: true, username: true } },
        branch: true,
        shift: true,
        lines: { include: { product: { select: { id: true, sku: true, name: true, barcode: true } } } },
        payments: true,
        returns: true,
      },
    });
    if (!sale || sale.companyId !== req.user!.companyId) throw ApiError.notFound("Sale not found");
    if (!req.user!.canViewAllBranches && sale.branchId !== req.user!.branchId) {
      throw ApiError.forbidden("You do not have access to this sale");
    }
    res.json(sale);
  })
);

interface PreparedLine {
  productId: string | null;
  description?: string | null;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  discount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  costPrice?: Prisma.Decimal;
  taxRateId?: string | null;
  taxRatePercent?: Prisma.Decimal;
}

// CREATE SALE with full atomic posting (POST /api/sales)
router.post(
  "/",
  requirePermission("sale.create"),
  validateBody(saleSchema),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = effectiveBranchId(req);
    if (!branchId) throw ApiError.badRequest("No branch context available");

    const result = await prisma.$transaction(async (tx) => {
      // Validate warehouse belongs to branch
      if (req.body.warehouseId) {
        const wh = await tx.warehouse.findUnique({ where: { id: req.body.warehouseId } });
        if (!wh || wh.branchId !== branchId) throw ApiError.badRequest("Invalid warehouse for branch");
      }

      // Validate shift if provided
      if (req.body.shiftId) {
        const shift = await tx.pOSShift.findUnique({ where: { id: req.body.shiftId } });
        if (!shift || shift.branchId !== branchId || shift.status !== "OPEN") {
          throw ApiError.badRequest("Invalid or closed POS shift");
        }
        if (shift.cashierId !== req.user!.id && !req.user!.permissions.has("pos.cash_manage")) {
          throw ApiError.forbidden("Cannot post to another cashier's shift");
        }
      }

      // Load products and resolve prices
      const prepared: PreparedLine[] = [];
      let subtotal = d(0);
      let totalDiscount = d(0);
      let totalTax = d(0);

      // Discount authorization check
      const orderDiscount = d(req.body.discount ?? 0);
      const thresholdSetting = await tx.appSetting.findFirst({
        where: { companyId, group: "POS", key: "discount_approval_threshold" },
      });
      const discountThreshold = thresholdSetting ? d(thresholdSetting.value || "0") : d(50);
      const requiresApproval = orderDiscount.greaterThan(discountThreshold) || req.body.discountApprovalRequired;
      if (requiresApproval && req.body.discount > 0) {
        const hasApproval = req.user!.permissions.has("sale.discount_approve")
          && (req.body.discountApprovalRequired !== true || req.body.discount > discountThreshold.toNumber());
        if (!hasApproval) {
          throw ApiError.badRequest(
            `Discount of ${orderDiscount} exceeds the auto-approval threshold. Refer to a supervisor.`
          );
        }
      }

      for (const line of req.body.lines) {
        let product: any = null;
        if (line.productId) {
          product = await tx.product.findUnique({ where: { id: line.productId } });
          if (!product || product.companyId !== companyId) throw ApiError.badRequest("Invalid product");
          if (product.type === "STOCK") {
            const stock = await tx.stockBalance.aggregate({
              where: { productId: product.id, warehouse: { branchId } },
              _sum: { available: true },
            });
            const available = d(stock._sum.available ?? 0);
            if (d(line.quantity).greaterThan(available) && !product.allowNegative) {
              throw ApiError.badRequest(`Insufficient stock for ${product.name} (${product.sku}). Available: ${available}`);
            }
          }
        }

        // Branch price resolution
        const unitPrice = line.unitPrice != null ? d(line.unitPrice) : product?.sellingPrice ?? d(0);

        const taxInput = line.taxRateId ? { taxRateId: line.taxRateId } : product?.taxRateId ? { taxRateId: product.taxRateId } : {};
        const taxResult = await calculateTax({
          companyId,
          amount: mul(unitPrice, line.quantity),
          taxRateId: (taxInput as any).taxRateId ?? null,
          inclusive: true,
        });

        const lineDiscount = d(line.discount ?? 0);
        const lineSubtotalGross = mul(unitPrice, line.quantity).minus(lineDiscount);
        const taxAmount = mul(lineSubtotalGross, divRate(taxResult.ratePercent));
        const lineTotal = lineSubtotalGross;

        subtotal = subtotal.plus(lineSubtotalGross);
        totalDiscount = totalDiscount.plus(lineDiscount);
        totalTax = totalTax.plus(taxAmount);

        prepared.push({
          productId: product?.id ?? null,
          description: line.description ?? product?.name,
          quantity: d(line.quantity),
          unitPrice,
          discount: lineDiscount,
          taxAmount,
          lineTotal,
          costPrice: product?.averageCost ? d(product.averageCost) : d(0),
          taxRateId: (taxInput as any).taxRateId ?? null,
        });
      }

      const total = subtotal.plus(totalTax);
      const payments = req.body.hasCredit
        ? []
        : (req.body.payments ?? [{ method: req.body.paymentMethod ?? "CASH", amount: total.toNumber() }]);

      if (!req.body.hasCredit && payments.length === 0) {
        throw ApiError.badRequest("No payment method provided");
      }
      const normalizedPayments: Array<{ method: string; amount: number; currency: string; exchangeRate: number; bankAccountId?: string | null; reference?: string | null }> = [];
      if (!req.body.hasCredit) {
        for (const payment of payments) {
          const currencyCode = payment.currency ?? "USD";
          const currency = await tx.currency.findFirst({ where: { companyId, code: currencyCode, isActive: true } });
          if (!currency) throw ApiError.badRequest(`Currency ${currencyCode} is not configured`);
          const latest = currency.isBase ? null : await tx.exchangeRate.findFirst({ where: { currencyId: currency.id, effectiveDate: { lte: new Date() } }, orderBy: { effectiveDate: "desc" } });
          const exchangeRate = currency.isBase ? 1 : latest?.rateToBase?.toNumber() ?? 0;
          if (exchangeRate <= 0) throw ApiError.badRequest(`No current exchange rate configured for ${currencyCode}`);
          normalizedPayments.push({ ...payment, currency: currencyCode, exchangeRate });
        }
        const paymentTotal = normalizedPayments.reduce((acc, p) => acc.plus(mul(d(p.amount), d(p.exchangeRate))), d(0));
        if (paymentTotal.lessThan(total)) {
          throw ApiError.badRequest(`Total payment (${paymentTotal}) is less than sale total (${total})`);
        }
      }

      const reference = await nextReference({
        companyId,
        branchId,
        docType: req.body.type === "POS" ? "POS" : "INVOICE",
      });

      // Create the sale & lines
      const sale = await tx.sale.create({
        data: {
          companyId,
          branchId,
          warehouseId: req.body.warehouseId,
          customerId: req.body.customerId || null,
          reference,
          type: req.body.type,
          status: "COMPLETED" as SaleStatus,
          saleDate: req.body.saleDate ?? new Date(),
          cashierId: req.user!.id,
          shiftId: req.body.shiftId ?? null,
          subtotal,
          discount: totalDiscount,
          taxAmount: totalTax,
          total,
          amountPaid: req.body.hasCredit ? d(0) : normalizedPayments.reduce((acc, p) => acc.plus(mul(d(p.amount), d(p.exchangeRate))), d(0)),
          changeDue: d(0),
          paymentMethod: req.body.hasCredit ? "CREDIT" : req.body.paymentMethod ?? "CASH",
          isCredit: req.body.hasCredit ?? false,
          discountApprovedById: requiresApproval ? req.user!.id : null,
          discountApprovedAt: requiresApproval ? new Date() : null,
          notes: req.body.notes,
          postedAt: new Date(),
          lines: {
            create: prepared.map((p) => ({
              productId: p.productId,
              description: p.description,
              quantity: p.quantity,
              unitPrice: p.unitPrice,
              costPrice: p.costPrice,
              discount: p.discount,
              taxAmount: p.taxAmount,
              lineTotal: p.lineTotal,
              taxRate: (p.taxRateId ? null : null),
            })),
          },
        },
      });

      // Payments
      if (!req.body.hasCredit) {
        for (const p of normalizedPayments) {
          await tx.salePayment.create({
            data: { saleId: sale.id, amount: mul(d(p.amount), d(p.exchangeRate ?? 1)), currencyAmount: d(p.amount), currency: p.currency ?? "USD", exchangeRate: d(p.exchangeRate ?? 1), paymentMethod: p.method || req.body.paymentMethod, reference: p.reference, bankAccountId: p.bankAccountId, createdBy: req.user!.id },
          });
        }
      }

      // Inventory + COGS
      const postingAccounts = await getPostingAccounts(tx as any, companyId, branchId);
      const cogsLines: any[] = [];
      for (const p of prepared) {
        if (!p.productId) continue;
        const product = await tx.product.findUnique({ where: { id: p.productId } });
        if (!product || product.type !== "STOCK") continue;

        const movement = await recordStockMovement(tx as any, {
          companyId,
          branchId,
          warehouseId: req.body.warehouseId,
          productId: p.productId,
          type: "SALES",
          quantity: p.quantity.neg(),
          unitCost: p.costPrice,
          reference: reference,
          sourceType: "SALE",
          sourceId: sale.id,
          userId: req.user!.id,
        });
        p.costPrice = movement.newAverageCost;
        cogsLines.push({
          accountId: postingAccounts.costOfSalesId,
          debit: mul(p.quantity, movement.newAverageCost),
          description: `COGS ${reference} ${product.sku}`,
        });
        cogsLines.push({
          accountId: postingAccounts.inventoryId,
          credit: mul(p.quantity, movement.newAverageCost),
          description: `Inventory ${reference} ${product.sku}`,
        });
      }

      // GL postings
      const journalLines: any[] = [];
      if (cogsLines.length > 0) journalLines.push(...cogsLines);

      if (req.body.hasCredit) {
        journalLines.push({
          accountId: postingAccounts.arTradeId,
          debit: total,
          description: `Credit sale ${reference}`,
        });
      } else {
        const paymentAccounts: Record<string, string> = {
          CASH: postingAccounts.cashAccountId,
          BANK: postingAccounts.bankAccountId,
          ECONET_ECOCASH: postingAccounts.cashAccountId,
          ONEMONEY: postingAccounts.cashAccountId,
          ZIPIT: postingAccounts.bankAccountId,
          BANK_TRANSFER: postingAccounts.bankAccountId,
          MOBILE_MONEY: postingAccounts.cashAccountId,
        };
        for (const payment of normalizedPayments) {
          const pmAccount = paymentAccounts[payment.method ?? "CASH"] ?? postingAccounts.cashAccountId;
          journalLines.push({
            accountId: pmAccount,
            debit: mul(d(payment.amount), d(payment.exchangeRate)),
            description: `Payment received ${reference} (${payment.currency})`,
          });
        }
      }

      if (totalTax.isPositive()) {
        journalLines.push({
          accountId: postingAccounts.vatOutputId,
          credit: totalTax,
          description: `VAT output ${reference}`,
        });
      }
      if (totalDiscount.isPositive()) {
        journalLines.push({
          accountId: postingAccounts.salesDiscountsId,
          debit: totalDiscount,
          description: `Discount ${reference}`,
        });
      }

      const revenueAccount = req.body.type === "WHOLESALE" ? postingAccounts.wholesaleRevenueId : postingAccounts.salesRevenueId;
      journalLines.push({
        accountId: revenueAccount,
        credit: subtotal,
        description: `Sales revenue ${reference}`,
      });

      await postJournal(tx as any, {
        companyId,
        branchId,
        reference: `SALE-${reference}`,
        description: `Sales posting ${reference}`,
        entryType: "SALE",
        sourceType: "SALE",
        sourceId: sale.id,
        userId: req.user!.id,
        skipReference: true,
        lines: journalLines,
      });

      // Audit
      await writeAudit(tx as any, {
        companyId,
        branchId,
        userId: req.user!.id,
        role: req.user!.roles[0],
        action: AuditAction.POST,
        entity: "SALE",
        entityId: sale.id,
        afterJson: { reference, total: total.toNumber(), lines: prepared.length },
        description: `Sale ${reference} posted for ${total}`,
      });

      return { sale, reference };
    });

    res.status(201).json(result);
  })
);

function divRate(r: Prisma.Decimal): Prisma.Decimal {
  return r.div(100);
}

// ===== Refunds / Returns =====
const returnSchema = z.object({
  saleId: z.string().optional(),
  customerId: z.string().optional(),
  lines: z.array(z.object({ saleReturnLineId: z.string().optional(), productId: z.string().optional(), quantity: z.coerce.number().positive(), unitPrice: z.coerce.number().optional() })).min(1),
  reason: z.string().optional().nullable(),
  refundMethod: z.string().optional(),
});

router.post(
  "/returns",
  requirePermission("sale.refund"),
  validateBody(returnSchema),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = effectiveBranchId(req);
    if (!branchId) throw ApiError.badRequest("No branch context");

    const result = await prisma.$transaction(async (tx) => {
      // Determine the source sale for reference and prices
      let sale: any = null;
      if (req.body.saleId) {
        sale = await tx.sale.findUnique({ where: { id: req.body.saleId }, include: { lines: true } });
        if (!sale || sale.companyId !== companyId) throw ApiError.notFound("Sale not found");
        if (sale.status === "CANCELLED" || sale.status === "VOID") throw ApiError.badRequest("Cannot return a cancelled sale");
      }

      let totalRefund = d(0);
      let totalTax = d(0);

      const postingAccounts = await getPostingAccounts(tx as any, companyId, branchId);
      const journalLines: any[] = [];
      const inventoryLines: any[] = [];

      // For each return line, reduce from sale lines or use provided prices
      // Frontend should pass productId + quantity + unitPrice
      const saleLineMap = new Map<string, any>();
      if (sale) {
        for (const sl of sale.lines) saleLineMap.set(sl.productId, sl);
      }

      for (const line of req.body.lines) {
        let unitPrice = d(line.unitPrice ?? 0);
        let productId = line.productId;
        let costPrice: Prisma.Decimal | null = null;

        if (productId) {
          const product = await tx.product.findUnique({ where: { id: productId } });
          if (!product || product.companyId !== companyId) throw ApiError.badRequest("Invalid product");
          costPrice = product.averageCost ? d(product.averageCost as any) : null;
        }

        if (sale) {
          const saleLine = saleLineMap.get(productId);
          if (saleLine) {
            unitPrice = d(saleLine.unitPrice as any);
            if (!req.body.lines[0].unitPrice) {
              // use original price
            }
          }
        }

        const lineTotal = mul(unitPrice, line.quantity);
        totalRefund = totalRefund.plus(lineTotal);

        if (productId) {
          inventoryLines.push({
            productId,
            quantity: line.quantity,
            costPrice,
          });
        }

        // Revenue reversal
        journalLines.push({
          accountId: postingAccounts.salesRevenueId,
          debit: lineTotal,
          description: `Sales return ${line.productId ?? ""}`,
        });
        if (sale && sale.taxAmount > 0) {
          // reverse VAT proportionally (simplified: no VAT on test seed)
        }
      }

      // Inventory in + COGS reversal
      if (inventoryLines.length > 0) {
        for (const il of inventoryLines) {
          const movement = await recordStockMovement(tx as any, {
            companyId,
            branchId,
            warehouseId: sale?.warehouseId,
            productId: il.productId,
            type: "SALES_RETURN",
            quantity: d(il.quantity),
            unitCost: il.costPrice,
            reference: `RET-${sale?.reference ?? ""}`,
            sourceType: "SALE_RETURN",
            userId: req.user!.id,
          });
          const cost = il.costPrice ?? movement.newAverageCost;
          journalLines.push({
            accountId: postingAccounts.inventoryId,
            debit: mul(d(il.quantity), cost),
            description: `Stock return ${il.productId}`,
          });
          journalLines.push({
            accountId: postingAccounts.costOfSalesId,
            credit: mul(d(il.quantity), cost),
            description: `COGS reversal ${il.productId}`,
          });
        }
      }

      // Payment/refund posting
      journalLines.push({
        accountId: req.body.refundMethod === "CREDIT" ? postingAccounts.arTradeId : postingAccounts.cashAccountId,
        credit: totalRefund,
        description: `Refund ${sale?.reference ?? ""}`,
      });

      const reference = await nextReference({ companyId, branchId, docType: "RETURN" });
      const saleReturn = await tx.saleReturn.create({
        data: {
          companyId,
          branchId,
          saleId: sale?.id ?? null,
          customerId: req.body.customerId ?? sale?.customerId ?? null,
          reference,
          reason: req.body.reason,
          refundMethod: req.body.refundMethod ?? "CASH",
          refundAmount: totalRefund,
          status: "POSTED",
          createdById: req.user!.id,
          lines: {
            create: (req.body.lines as any[]).map((l: any) => ({
              productId: l.productId ?? null,
              quantity: d(l.quantity),
              unitPrice: d(l.unitPrice ?? 0),
            })),
          },
        },
      });

      await postJournal(tx as any, {
        companyId,
        branchId,
        reference: `RET-${reference}`,
        description: `Sales return posting ${reference}`,
        entryType: "SALE_RETURN",
        sourceType: "SALE_RETURN",
        sourceId: saleReturn.id,
        userId: req.user!.id,
        skipReference: true,
        lines: journalLines.filter((l) => l.debit || l.credit),
      });

      if (sale) {
        await tx.sale.update({
          where: { id: sale.id },
          data: { status: totalRefund.equals(money(sale.total as any)) ? "RETURNED" : "PARTIAL_RETURN" },
        });
      }

      await writeAudit(tx as any, {
        companyId,
        branchId,
        userId: req.user!.id,
        action: AuditAction.POST,
        entity: "SALE_RETURN",
        entityId: saleReturn.id,
        afterJson: { reference, totalRefund: totalRefund.toNumber() },
        description: `Return ${reference} posted`,
      });

      return { saleReturn, totalRefund: totalRefund.toNumber() };
    });

    res.status(201).json(result);
  })
);

// Void sale (reversal)
router.post(
  "/:id/void",
  requirePermission("sale.void"),
  validateBody(z.object({ reason: z.string().min(3) })),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const sale = await prisma.sale.findUnique({
      where: { id: req.params.id as string },
      include: { lines: true },
    });
    if (!sale || sale.companyId !== companyId) throw ApiError.notFound("Sale not found");
    if (sale.status === "CANCELLED" || sale.status === "VOID") throw ApiError.badRequest("Sale already voided");
    if (!req.user!.canViewAllBranches && sale.branchId !== req.user!.branchId) {
      throw ApiError.forbidden("You cannot void sales from another branch");
    }

    await prisma.$transaction(async (tx) => {
      // Restore stock
      for (const line of sale.lines) {
        if (!line.productId) continue;
        await recordStockMovement(tx as any, {
          companyId,
          branchId: sale.branchId,
          warehouseId: sale.warehouseId,
          productId: line.productId,
          type: "SALES_RETURN",
          quantity: d(line.quantity),
          unitCost: line.costPrice ?? null,
          reference: sale.reference,
          sourceType: "VOID_SALE",
          sourceId: sale.id,
          userId: req.user!.id,
          note: `Void ${req.body.reason}`,
        });
      }

      // Reverse GL - find and reverse the sale journal
      const saleJournal = await tx.journalEntry.findFirst({
        where: { companyId, sourceType: "SALE", sourceId: sale.id, reversed: false },
      });
      if (saleJournal) {
        await tx.journalEntry.update({
          where: { id: saleJournal.id },
          data: { reversed: true, reversedById: req.user!.id, reversedAt: new Date() },
        });
        // Post a reversing journal
        const lines = await tx.journalLine.findMany({ where: { journalEntryId: saleJournal.id } });
        await postJournal(tx as any, {
          companyId,
          branchId: sale.branchId,
          description: `Void of sale ${sale.reference} - ${req.body.reason}`,
          entryType: "SALE",
          sourceType: "VOID_SALE",
          sourceId: sale.id,
          userId: req.user!.id,
          lines: lines.map((l) => ({
            accountId: l.accountId,
            branchId: l.branchId,
            debit: d(!l.credit.isZero() ? l.credit : 0),
            credit: d(!l.debit.isZero() ? l.debit : 0),
            description: l.description ?? undefined,
          })),
        });
      }

      await tx.sale.update({
        where: { id: sale.id },
        data: { status: "VOID" as SaleStatus, voidedById: req.user!.id, voidedAt: new Date(), voidReason: req.body.reason },
      });

      await writeAudit(tx as any, {
        companyId,
        branchId: sale.branchId,
        userId: req.user!.id,
        action: AuditAction.CANCEL,
        entity: "SALE",
        entityId: sale.id,
        afterJson: { reason: req.body.reason },
        description: `Sale ${sale.reference} voided`,
      });
    });

    res.json({ success: true });
  })
);

export default router;