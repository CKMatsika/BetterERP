import { Router } from "express";
import { z } from "zod";
import { Prisma, PurchaseStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { asyncHandler, parsePagination } from "../utils/handlers";
import { validateBody } from "../middleware/validate";
import { requirePermission, effectiveBranchId } from "../middleware/auth";
import { writeAudit } from "../services/audit.service";
import { AuditAction } from "@prisma/client";
import { postJournal } from "../services/accounting.service";
import { recordStockMovement } from "../services/inventory.service";
import { getPostingAccounts } from "../services/postingAccounts.service";
import { nextReference } from "../services/sequence.service";
import { createApprovalRequest, actOnApproval } from "../services/approval.service";
import { createNotification } from "../services/notification.service";
import { d, mul } from "../utils/money";

const router = Router();

const poLineSchema = z.object({
  productId: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  quantity: z.coerce.number().positive(),
  unitCost: z.coerce.number().nonnegative(),
  taxRate: z.coerce.number().optional().default(0),
});

const poSchema = z.object({
  branchId: z.string().optional(),
  supplierId: z.string(),
  lines: z.array(poLineSchema).min(1),
  orderDate: z.coerce.date().optional(),
  expectedDate: z.coerce.date().optional(),
  currency: z.string().optional(),
  notes: z.string().optional().nullable(),
});

const supplierSchema = z.object({
  code: z.string().optional().nullable(),
  name: z.string().min(1),
  taxNumber: z.string().optional().nullable(),
  contactPerson: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  province: z.string().optional().nullable(),
  currency: z.string().optional(),
  creditLimit: z.coerce.number().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  bankAccount: z.string().optional().nullable(),
  branchId: z.string().optional().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
});

// ===== SUPPLIERS =====
router.get(
  "/suppliers",
  requirePermission("supplier.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const where: Prisma.SupplierWhereInput = { companyId: req.user!.companyId };
    if (req.query.search as string) {
      where.OR = [
        { name: { contains: req.query.search as string, mode: "insensitive" } },
        { code: { contains: req.query.search as string, mode: "insensitive" } },
        { contactPerson: { contains: req.query.search as string, mode: "insensitive" } },
      ];
    }
    const [total, items] = await Promise.all([
      prisma.supplier.count({ where }),
      prisma.supplier.findMany({
        where,
        orderBy: { name: "asc" },
        skip,
        take: pageSize,
        include: {
          contacts: true,
          _count: { select: { purchaseOrders: true, invoices: true } },
        },
      }),
    ]);

    // Payable balances
    const supplierIds = items.map((s) => s.id);
    const invoiceAgg = await prisma.supplierInvoice.groupBy({
      by: ["supplierId"],
      where: { supplierId: { in: supplierIds }, status: { in: ["OPEN", "PARTIAL", "OVERDUE"] } },
      _sum: { total: true, amountPaid: true },
    });
    const invMap = new Map(invoiceAgg.map((i) => [i.supplierId, i._sum]));
    const paymentAgg = await prisma.supplierPayment.groupBy({
      by: ["supplierId"],
      where: { supplierId: { in: supplierIds } },
      _sum: { amount: true },
    });
    const payMap = new Map(paymentAgg.map((p) => [p.supplierId, p._sum]));

    res.json({
      items: items.map((s) => {
        const inv = invMap.get(s.id);
        const due = d(inv?.total ?? 0).minus(d(inv?.amountPaid ?? 0)).plus(d(payMap.get(s.id)?.amount ?? 0));
        return { ...s, outstandingBalance: due.minus(d(payMap.get(s.id)?.amount ?? 0)).toNumber() };
      }),
      total,
      page,
      pageSize,
    });
  })
);

router.get(
  "/suppliers/:id",
  requirePermission("supplier.view"),
  asyncHandler(async (req, res) => {
    const supplier = await prisma.supplier.findUnique({
      where: { id: req.params.id as string },
      include: {
        contacts: true,
        purchaseOrders: { orderBy: { createdAt: "desc" }, take: 50 },
        invoices: { orderBy: { invoiceDate: "desc" }, take: 50 },
        payments: { orderBy: { paymentDate: "desc" }, take: 50 },
        products: { include: { product: { select: { id: true, sku: true, name: true } } } },
      },
    });
    if (!supplier || supplier.companyId !== req.user!.companyId) throw ApiError.notFound("Supplier not found");
    res.json(supplier);
  })
);

router.post(
  "/suppliers",
  requirePermission("supplier.create"),
  validateBody(supplierSchema),
  asyncHandler(async (req, res) => {
    const branchId = req.body.branchId ?? req.user!.branchId;
    let reference = req.body.code;
    if (!reference) {
      reference = await nextReference({ companyId: req.user!.companyId, branchId, docType: "SUPPLIER" });
    }
    const supplier = await prisma.supplier.create({
      data: { companyId: req.user!.companyId, branchId, code: reference, ...req.body },
    });
    await writeAudit(prisma as any, {
      companyId: req.user!.companyId,
      branchId,
      userId: req.user!.id,
      action: AuditAction.CREATE,
      entity: "SUPPLIER",
      entityId: supplier.id,
      description: `Created supplier ${supplier.name}`,
    });
    res.status(201).json(supplier);
  })
);

router.put(
  "/suppliers/:id",
  requirePermission("supplier.edit"),
  validateBody(supplierSchema.partial()),
  asyncHandler(async (req, res) => {
    const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id as string } });
    if (!supplier || supplier.companyId !== req.user!.companyId) throw ApiError.notFound("Supplier not found");
    const updated = await prisma.supplier.update({ where: { id: supplier.id }, data: req.body });
    res.json(updated);
  })
);

router.get(
  "/suppliers/import/template",
  requirePermission("supplier.view"),
  asyncHandler(async (_req, res) => {
    const headers = ["code", "name", "taxNumber", "contactPerson", "phone", "email", "address", "city", "paymentTerms", "currency"];
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=suppliers-import-template.csv");
    res.send(headers.join(",") + "\n");
  })
);

router.post(
  "/suppliers/import",
  requirePermission("supplier.create"),
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
          const existing = row.code ? await tx.supplier.findFirst({ where: { companyId: req.user!.companyId, code: row.code.trim() } }) : null;
          const data = { name: row.name.trim(), taxNumber: row.taxNumber || null, contactPerson: row.contactPerson || null, phone: row.phone || null, email: row.email || null, address: row.address || null, city: row.city || null, paymentTerms: row.paymentTerms || null, currency: row.currency || "USD", branchId: row.branchId || req.user!.branchId };
          if (existing) { await tx.supplier.update({ where: { id: existing.id }, data }); updated += 1; }
          else { await tx.supplier.create({ data: { companyId: req.user!.companyId, code: row.code || null, ...data } }); created += 1; }
        } catch (error) { errors.push({ row: index + 2, error: error instanceof Error ? error.message : "Invalid row" }); }
      }
    });
    res.json({ success: true, summary: { total: rows.length, created, updated, skipped: 0, errors: errors.length }, errors: errors.slice(0, 50) });
  })
);

// ===== PURCHASE ORDERS =====
router.get(
  "/purchase-orders",
  requirePermission("purchase.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const where: Prisma.PurchaseOrderWhereInput = { companyId: req.user!.companyId };
    const branchId = effectiveBranchId(req);
    if (!req.user!.canViewAllBranches && branchId) where.branchId = branchId;
    if (req.query.branchId as string) where.branchId = req.query.branchId as string;
    if (req.query.supplierId as string) where.supplierId = req.query.supplierId as string;
    if (req.query.status as string) where.status = req.query.status as any;
    if (req.query.search as string) {
      where.OR = [
        { reference: { contains: req.query.search as string, mode: "insensitive" } },
        { supplier: { name: { contains: req.query.search as string, mode: "insensitive" } } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.purchaseOrder.count({ where }),
      prisma.purchaseOrder.findMany({
        where,
        include: {
          supplier: { select: { id: true, name: true, code: true } },
          branch: { select: { id: true, name: true, code: true } },
          lines: true,
          _count: { select: { receipts: true, invoices: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
    ]);
    res.json({ items, total, page, pageSize });
  })
);

router.get(
  "/purchase-orders/:id",
  requirePermission("purchase.view"),
  asyncHandler(async (req, res) => {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id as string },
      include: {
        supplier: true,
        branch: true,
        lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
        receipts: { include: { lines: true } },
        invoices: { include: { lines: true, payments: true } },
      },
    });
    if (!po || po.companyId !== req.user!.companyId) throw ApiError.notFound("Purchase order not found");
    res.json(po);
  })
);

router.post(
  "/purchase-orders",
  requirePermission("purchase.create"),
  validateBody(poSchema),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = req.body.branchId ?? req.user!.branchId;
    if (!branchId) throw ApiError.badRequest("No branch context");

    return prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: req.body.supplierId } });
      if (!supplier || supplier.companyId !== companyId) throw ApiError.notFound("Supplier not found");

      const reference = await nextReference({ companyId, branchId, docType: "PURCHASE_ORDER" });

      let subtotal = d(0);
      let taxTotal = d(0);
      const lines: Array<{
        productId: string | null;
        description: string | null;
        quantity: Prisma.Decimal;
        unitCost: Prisma.Decimal;
        taxRate: Prisma.Decimal;
        taxAmount: Prisma.Decimal;
        lineTotal: Prisma.Decimal;
      }> = [];

      for (const line of req.body.lines) {
        const qty = d(line.quantity);
        const unitCost = d(line.unitCost);
        const taxRate = d(line.taxRate ?? 0);
        const lineSubtotal = mul(qty, unitCost);
        const taxAmount = mul(lineSubtotal, taxRate.div(100));
        const lineTotal = lineSubtotal.plus(taxAmount);

        subtotal = subtotal.plus(lineSubtotal);
        taxTotal = taxTotal.plus(taxAmount);

        lines.push({
          productId: line.productId ?? null,
          description: line.description ?? null,
          quantity: qty,
          unitCost,
          taxRate,
          taxAmount,
          lineTotal,
        });
      }

      const po = await tx.purchaseOrder.create({
        data: {
          companyId,
          branchId,
          supplierId: supplier.id,
          reference,
          status: "PENDING_APPROVAL" as PurchaseStatus,
          orderDate: req.body.orderDate ?? new Date(),
          expectedDate: req.body.expectedDate,
          currency: req.body.currency ?? supplier.currency ?? "USD",
          subtotal,
          taxAmount: taxTotal,
          total: subtotal.plus(taxTotal),
          notes: req.body.notes,
          createdById: req.user!.id,
          lines: { create: lines },
        },
      });

      const approvalId = await createApprovalRequest(tx as any, {
        companyId,
        branchId,
        entityType: "PURCHASE_ORDER",
        entityId: po.id,
        entityRef: reference,
        requestedById: req.user!.id,
        amount: subtotal.plus(taxTotal),
        workflowType: "PURCHASE_ORDER",
      });

      // Notify approver roles
      await createNotification(tx as any, {
        companyId,
        branchId,
        type: "PO_APPROVAL",
        title: `Purchase order ${reference} awaiting approval`,
        message: `Purchase order ${reference} for ${supplier.name} (${subtotal.plus(taxTotal)}) requires approval`,
        entityType: "PURCHASE_ORDER",
        entityId: po.id,
        priority: "HIGH",
      });

      await writeAudit(tx as any, {
        companyId,
        branchId,
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entity: "PURCHASE_ORDER",
        entityId: po.id,
        afterJson: { reference, total: subtotal.plus(taxTotal).toNumber(), approvalId },
        description: `Created purchase order ${reference}`,
      });

      return { po, approvalId };
    }).then((r) => res.status(201).json(r));
  })
);

router.post(
  "/purchase-orders/:id/approve",
  requirePermission("purchase.approve"),
  validateBody(z.object({ comments: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id as string } });
    if (!po || po.companyId !== req.user!.companyId) throw ApiError.notFound("Purchase order not found");
    if (po.status !== "PENDING_APPROVAL") throw ApiError.badRequest("Purchase order is not pending approval");

    const approval = await prisma.approvalRequest.findFirst({
      where: { entityType: "PURCHASE_ORDER", entityId: po.id, status: "PENDING" },
    });

    await prisma.$transaction(async (tx) => {
      if (approval) {
        await actOnApproval(req.user!.id, approval.id, "APPROVE", req.body.comments);
      }
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: "APPROVED", approvedById: req.user!.id, approvedAt: new Date() },
      });
      await writeAudit(tx as any, {
        companyId: req.user!.companyId,
        branchId: po.branchId,
        userId: req.user!.id,
        action: AuditAction.APPROVE,
        entity: "PURCHASE_ORDER",
        entityId: po.id,
        description: `Approved purchase order ${po.reference}`,
      });
    });
    res.json({ success: true, status: "APPROVED" });
  })
);

router.post(
  "/purchase-orders/:id/cancel",
  requirePermission("purchase.cancel"),
  validateBody(z.object({ reason: z.string().min(3) })),
  asyncHandler(async (req, res) => {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id as string } });
    if (!po || po.companyId !== req.user!.companyId) throw ApiError.notFound("Purchase order not found");
    if (po.status === "RECEIVED" || po.status === "COMPLETED") throw ApiError.badRequest("Cannot cancel a received purchase order");
    await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { status: "CANCELLED", notes: `${po.notes ?? ""}\nCancelled: ${req.body.reason}` },
    });
    res.json({ success: true });
  })
);

// ===== GOODS RECEIPT (GRN) =====
const grnSchema = z.object({
  branchId: z.string().optional(),
  warehouseId: z.string(),
  purchaseOrderId: z.string(),
  lines: z.array(z.object({
    purchaseOrderLineId: z.string(),
    productId: z.string().optional().nullable(),
    quantity: z.coerce.number().positive(),
    unitCost: z.coerce.number().optional(),
    locationId: z.string().optional().nullable(),
  })).min(1),
  receiptDate: z.coerce.date().optional(),
  note: z.string().optional().nullable(),
});

router.post(
  "/goods-receipts",
  requirePermission("inventory.receive"),
  validateBody(grnSchema),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = req.body.branchId ?? req.user!.branchId!;
    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({
        where: { id: req.body.purchaseOrderId },
        include: { lines: true },
      });
      if (!po || po.companyId !== companyId) throw ApiError.notFound("Purchase order not found");
      if (!["APPROVED", "PARTIAL_RECEIVED"].includes(po.status)) {
        throw ApiError.badRequest(`Goods can only be received against approved orders (current status: ${po.status})`);
      }
      if (po.branchId !== branchId) throw ApiError.badRequest("PO must be received at its branch");

      const ref = await nextReference({ companyId, branchId, docType: "GRN" });

      const lines: any[] = [];
      let totalQty = d(0);
      let inventoryTotal = d(0);
      const postingAccounts = await getPostingAccounts(tx as any, companyId, branchId);

      for (const l of req.body.lines) {
        const poLine = po.lines.find((pl) => pl.id === l.purchaseOrderLineId);
        if (!poLine) throw ApiError.badRequest("Invalid PO line");

        const productId = l.productId ?? poLine.productId;
        if (!productId) throw ApiError.badRequest("Product required for GRN line");
        const product = await tx.product.findUnique({ where: { id: productId } });
        if (!product || product.companyId !== companyId) throw ApiError.badRequest("Invalid product");

        const qty = d(l.quantity);
        const unitCost = d(l.unitCost ?? poLine.unitCost);
        const lineTotal = mul(qty, unitCost);
        totalQty = totalQty.plus(qty);
        inventoryTotal = inventoryTotal.plus(lineTotal);

        await recordStockMovement(tx as any, {
          companyId,
          branchId,
          warehouseId: req.body.warehouseId,
          locationId: l.locationId,
          productId,
          type: "PURCHASE_RECEIPT",
          quantity: qty,
          unitCost,
          reference: ref,
          sourceType: "GRN",
          sourceId: ref,
          userId: req.user!.id,
        });

        // Update PO line received/backorder quantities
        const receivedQty = d(poLine.receivedQty ?? 0).plus(qty);
        const backorderQty = d(poLine.quantity).minus(receivedQty);
        await tx.purchaseOrderLine.update({
          where: { id: poLine.id },
          data: { receivedQty, backorderQty: backorderQty.isNegative() ? d(0) : backorderQty },
        });

        lines.push({
          purchaseOrderLineId: poLine.id,
          productId,
          quantity: qty,
          unitCost,
          taxAmount: poLine.taxAmount,
          lineTotal,
          locationId: l.locationId,
        });
      }

      const grn = await tx.goodsReceipt.create({
        data: {
          companyId,
          branchId,
          warehouseId: req.body.warehouseId,
          purchaseOrderId: po.id,
          supplierId: po.supplierId,
          reference: ref,
          receiptDate: req.body.receiptDate ?? new Date(),
          status: "POSTED",
          receivedById: req.user!.id,
          totalQty,
          note: req.body.note,
          lines: { create: lines },
        },
      });

      // Update PO status
      const receivedByLine = new Map<string, Prisma.Decimal>();
      for (const line of req.body.lines) {
        receivedByLine.set(line.purchaseOrderLineId, d(receivedByLine.get(line.purchaseOrderLineId) ?? 0).plus(d(line.quantity)));
      }
      const allReceived = po.lines.every((pl) => d(pl.receivedQty).plus(receivedByLine.get(pl.id) ?? d(0)).gte(d(pl.quantity)));
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: allReceived ? "RECEIVED" : "PARTIAL_RECEIVED" },
      });

      // GRNs increase inventory while the supplier invoice is still outstanding.
      const journalLines: any[] = [
        { accountId: postingAccounts.inventoryId, debit: inventoryTotal, description: `GRN ${ref} stock received` },
        { accountId: postingAccounts.goodsReceivedNotInvoicedId, credit: inventoryTotal, description: `GRN ${ref} (awaiting supplier invoice)` },
      ];
      await postJournal(tx as any, {
        companyId,
        branchId,
        reference: `GRN-${ref}`,
        description: `Goods received ${ref} for PO ${po.reference}`,
        entryType: "PURCHASE",
        sourceType: "GRN",
        sourceId: grn.id,
        userId: req.user!.id,
        skipReference: true,
        lines: journalLines,
      });

      await writeAudit(tx as any, {
        companyId,
        branchId,
        userId: req.user!.id,
        action: AuditAction.POST,
        entity: "GOODS_RECEIPT",
        entityId: grn.id,
        afterJson: { reference: ref, qty: totalQty.toNumber() },
        description: `Goods received ${ref}`,
      });
      return { grn };
    }).then((r) => res.status(201).json(r));
  })
);

router.get(
  "/goods-receipts",
  requirePermission("purchase.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const where: Prisma.GoodsReceiptWhereInput = { companyId: req.user!.companyId };
    const branchId = effectiveBranchId(req);
    if (!req.user!.canViewAllBranches && branchId) where.branchId = branchId;
    if (req.query.purchaseOrderId as string) where.purchaseOrderId = req.query.purchaseOrderId as string;
    const [total, rawItems] = await Promise.all([
      prisma.goodsReceipt.count({ where }),
      prisma.goodsReceipt.findMany({
        where,
        include: {
          purchaseOrder: { select: { id: true, reference: true, supplier: { select: { id: true, name: true } } } },
          lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
        },
        orderBy: { receiptDate: "desc" },
        skip,
        take: pageSize,
      }),
    ]);
    const warehouseIds = rawItems.map((item) => item.warehouseId).filter((id): id is string => Boolean(id));
    const warehouses = await prisma.warehouse.findMany({
      where: { id: { in: warehouseIds }, branch: { companyId: req.user!.companyId } },
      select: { id: true, name: true },
    });
    const warehouseMap = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));
    const items = rawItems.map((item) => ({ ...item, warehouse: item.warehouseId ? warehouseMap.get(item.warehouseId) ?? null : null }));
    res.json({ items, total, page, pageSize });
  })
);

// ===== SUPPLIER INVOICES =====
const supplierInvoiceSchema = z.object({
  branchId: z.string().optional(),
  supplierId: z.string(),
  purchaseOrderId: z.string().optional().nullable(),
  reference: z.string().min(1),
  invoiceDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional().nullable(),
  lines: z.array(z.object({
    purchaseOrderLineId: z.string().optional().nullable(),
    productId: z.string().optional().nullable(),
    quantity: z.coerce.number().positive(),
    unitCost: z.coerce.number().nonnegative(),
  })).min(1),
});

const purchaseReturnSchema = z.object({
  branchId: z.string().optional(),
  warehouseId: z.string(),
  supplierId: z.string(),
  reason: z.string().optional().nullable(),
  returnDate: z.coerce.date().optional(),
  lines: z.array(z.object({ productId: z.string(), quantity: z.coerce.number().positive(), unitCost: z.coerce.number().nonnegative() })).min(1),
});

router.get(
  "/purchase-returns",
  requirePermission("purchase.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const where: Prisma.PurchaseReturnWhereInput = { companyId: req.user!.companyId };
    const branchId = effectiveBranchId(req);
    if (!req.user!.canViewAllBranches && branchId) where.branchId = branchId;
    const [total, rawItems] = await Promise.all([
      prisma.purchaseReturn.count({ where }),
      prisma.purchaseReturn.findMany({ where, include: { lines: true }, orderBy: { returnDate: "desc" }, skip, take: pageSize }),
    ]);
    const productIds = rawItems.flatMap((item) => item.lines.map((line) => line.productId).filter((id): id is string => Boolean(id)));
    const products = await prisma.product.findMany({ where: { companyId: req.user!.companyId, id: { in: productIds } }, select: { id: true, sku: true, name: true } });
    const productMap = new Map(products.map((product) => [product.id, product]));
    const items = rawItems.map((item) => ({ ...item, lines: item.lines.map((line) => ({ ...line, product: line.productId ? productMap.get(line.productId) ?? null : null })) }));
    res.json({ items, total, page, pageSize });
  })
);

router.post(
  "/purchase-returns",
  requirePermission("purchase.post"),
  validateBody(purchaseReturnSchema),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = req.body.branchId ?? req.user!.branchId;
    if (!branchId) throw ApiError.badRequest("No branch context");
    const result = await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: req.body.supplierId } });
      if (!supplier || supplier.companyId !== companyId) throw ApiError.notFound("Supplier not found");
      const reference = await nextReference({ companyId, branchId, docType: "PURCHASE_RETURN" });
      const postingAccounts = await getPostingAccounts(tx as any, companyId, branchId);
      let total = d(0);
      const lines: Array<{ productId: string; quantity: Prisma.Decimal; unitCost: Prisma.Decimal; lineTotal: Prisma.Decimal }> = [];
      const journalLines: any[] = [];
      for (const line of req.body.lines) {
        const product = await tx.product.findUnique({ where: { id: line.productId } });
        if (!product || product.companyId !== companyId) throw ApiError.badRequest("Invalid product");
        const quantity = d(line.quantity);
        const movement = await recordStockMovement(tx as any, { companyId, branchId, warehouseId: req.body.warehouseId, productId: product.id, type: "PURCHASE_RETURN", quantity: quantity.neg(), unitCost: d(line.unitCost), reference, sourceType: "PURCHASE_RETURN", userId: req.user!.id });
        const cost = movement.newAverageCost;
        const lineTotal = mul(quantity, cost);
        total = total.plus(lineTotal);
        lines.push({ productId: product.id, quantity, unitCost: cost, lineTotal });
      }
      journalLines.push({ accountId: postingAccounts.apTradeId, debit: total, description: `Purchase return ${reference}` });
      journalLines.push({ accountId: postingAccounts.inventoryId, credit: total, description: `Inventory returned ${reference}` });
      const purchaseReturn = await tx.purchaseReturn.create({ data: { companyId, branchId, supplierId: supplier.id, reference, returnDate: req.body.returnDate ?? new Date(), reason: req.body.reason, status: "POSTED", total, lines: { create: lines } } });
      await postJournal(tx as any, { companyId, branchId, reference: `PR-${reference}`, description: `Purchase return to ${supplier.name}`, entryType: "PURCHASE_RETURN", sourceType: "PURCHASE_RETURN", sourceId: purchaseReturn.id, userId: req.user!.id, skipReference: true, lines: journalLines });
      await writeAudit(tx as any, { companyId, branchId, userId: req.user!.id, action: AuditAction.POST, entity: "PURCHASE_RETURN", entityId: purchaseReturn.id, afterJson: { reference, total: total.toNumber() } });
      return purchaseReturn;
    });
    res.status(201).json(result);
  })
);

router.post(
  "/supplier-invoices",
  requirePermission("purchase.post"),
  validateBody(supplierInvoiceSchema),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = req.body.branchId ?? req.user!.branchId!;
    return prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: req.body.supplierId } });
      if (!supplier || supplier.companyId !== companyId) throw ApiError.notFound("Supplier not found");

      const docReference = await nextReference({ companyId, branchId, docType: "SUPPLIER_INVOICE" });

      let subtotal = d(0);
      let taxTotal = d(0);
      let total = d(0);
      const receivedByLine = new Map<string, Prisma.Decimal>();
      if (req.body.purchaseOrderId) {
        const receivedLines = await tx.goodsReceiptLine.findMany({
          where: { purchaseOrderLineId: { not: null }, goodsReceipt: { purchaseOrderId: req.body.purchaseOrderId, companyId, status: "POSTED" } },
        });
        for (const line of receivedLines) {
          if (line.purchaseOrderLineId) receivedByLine.set(line.purchaseOrderLineId, d(receivedByLine.get(line.purchaseOrderLineId) ?? 0).plus(line.quantity));
        }
      }
      for (const l of req.body.lines) {
        if (req.body.purchaseOrderId && (!l.purchaseOrderLineId || d(receivedByLine.get(l.purchaseOrderLineId) ?? 0).lessThan(d(l.quantity)))) {
          throw ApiError.badRequest("Supplier invoice quantity exceeds goods received quantity");
        }
        const lineTotal = mul(d(l.quantity), d(l.unitCost));
        subtotal = subtotal.plus(lineTotal);
      }
      taxTotal = d(0);
      total = subtotal.plus(taxTotal);

      const invoice = await tx.supplierInvoice.create({
        data: {
          companyId,
          branchId,
          supplierId: supplier.id,
          purchaseOrderId: req.body.purchaseOrderId,
          reference: req.body.reference,
          docReference,
          invoiceDate: req.body.invoiceDate ?? new Date(),
          dueDate: req.body.dueDate,
          subtotal,
          taxAmount: taxTotal,
          total,
          status: "OPEN",
          posted: true,
          postedAt: new Date(),
          lines: {
            create: req.body.lines.map((l: any) => ({
              purchaseOrderLineId: l.purchaseOrderLineId,
              productId: l.productId,
              quantity: d(l.quantity),
              unitCost: d(l.unitCost),
              lineTotal: mul(d(l.quantity), d(l.unitCost)),
            })),
          },
        },
      });

      // A PO-backed invoice clears the GRNI liability created by its GRNs.
      const postingAccounts = await getPostingAccounts(tx as any, companyId, branchId);
      const debitAccount = req.body.purchaseOrderId ? postingAccounts.goodsReceivedNotInvoicedId : postingAccounts.inventoryId;
      await postJournal(tx as any, {
        companyId,
        branchId,
        reference: `SI-${docReference}`,
        description: `Supplier invoice ${req.body.reference} from ${supplier.name}`,
        entryType: "PURCHASE",
        sourceType: "SUPPLIER_INVOICE",
        sourceId: invoice.id,
        userId: req.user!.id,
        skipReference: true,
        lines: [
          { accountId: debitAccount, debit: total, description: `${req.body.reference} goods` },
          { accountId: postingAccounts.apTradeId, credit: total, description: `${req.body.reference} payable` },
        ],
      });

      await writeAudit(tx as any, {
        companyId,
        branchId,
        userId: req.user!.id,
        action: AuditAction.POST,
        entity: "SUPPLIER_INVOICE",
        entityId: invoice.id,
        afterJson: { reference: req.body.reference, total: total.toNumber() },
        description: `Supplier invoice ${req.body.reference}`,
      });
      return { invoice };
    }).then((r) => res.status(201).json(r));
  })
);

router.get(
  "/supplier-invoices",
  requirePermission("purchase.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const where: Prisma.SupplierInvoiceWhereInput = { companyId: req.user!.companyId };
    const branchId = effectiveBranchId(req);
    if (!req.user!.canViewAllBranches && branchId) where.branchId = branchId;
    if (req.query.supplierId as string) where.supplierId = req.query.supplierId as string;
    if (req.query.status as string) where.status = req.query.status as string;
    const [total, rawItems] = await Promise.all([
      prisma.supplierInvoice.count({ where }),
      prisma.supplierInvoice.findMany({
        where,
        include: {
          supplier: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } },
          lines: true,
          payments: true,
        },
        orderBy: { invoiceDate: "desc" },
        skip,
        take: pageSize,
      }),
    ]);
    const items = rawItems.map((invoice) => {
      const paidAmount = invoice.payments.reduce((sum, payment) => sum.plus(payment.amount), d(0));
      return {
        ...invoice,
        totals: {
          invoiceTotal: d(invoice.total).toNumber(),
          paidAmount: paidAmount.toNumber(),
          outstandingBalance: d(invoice.total).minus(paidAmount).toNumber(),
        },
      };
    });
    res.json({ items, total, page, pageSize });
  })
);

// ===== SUPPLIER PAYMENTS =====
const supplierPaymentSchema = z.object({
  supplierId: z.string(),
  invoiceId: z.string().optional().nullable(),
  branchId: z.string().optional(),
  amount: z.coerce.number().positive(),
  paymentMethod: z.string().default("BANK_TRANSFER"),
  bankAccountId: z.string().optional().nullable(),
  paymentDate: z.coerce.date().optional(),
  notes: z.string().optional().nullable(),
});

router.post(
  "/supplier-payments",
  requirePermission("purchase.post"),
  validateBody(supplierPaymentSchema),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = req.body.branchId ?? req.user!.branchId!;
    return prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: req.body.supplierId } });
      if (!supplier || supplier.companyId !== companyId) throw ApiError.notFound("Supplier not found");

      const invoice = req.body.invoiceId
        ? await tx.supplierInvoice.findUnique({ where: { id: req.body.invoiceId } })
        : null;
      if (req.body.invoiceId && (!invoice || invoice.companyId !== companyId || invoice.supplierId !== supplier.id)) {
        throw ApiError.badRequest("Invoice does not belong to this supplier");
      }
      if (invoice) {
        const outstanding = d(invoice.total).minus(d(invoice.amountPaid));
        if (d(req.body.amount).greaterThan(outstanding)) throw ApiError.badRequest("Payment exceeds the invoice outstanding balance");
      }

      const reference = await nextReference({ companyId, branchId, docType: "PAYMENT" });

      const payment = await tx.supplierPayment.create({
        data: {
          companyId,
          branchId,
          supplierId: supplier.id,
          invoiceId: req.body.invoiceId,
          reference,
          amount: d(req.body.amount),
          paymentMethod: req.body.paymentMethod,
          bankAccountId: req.body.bankAccountId,
          paymentDate: req.body.paymentDate ?? new Date(),
          currency: supplier.currency ?? "USD",
          notes: req.body.notes,
          posted: true,
          postedAt: new Date(),
        },
      });

      const postingAccounts = await getPostingAccounts(tx as any, companyId, branchId);
      const pmMethod = req.body.paymentMethod.toUpperCase();
      const pmAccount = pmMethod === "CASH" ? postingAccounts.cashAccountId : postingAccounts.bankAccountId;

      await postJournal(tx as any, {
        companyId,
        branchId,
        reference: `PAY-${reference}`,
        description: `Payment to supplier ${supplier.name} ${reference}`,
        entryType: "PAYMENT",
        sourceType: "SUPPLIER_PAYMENT",
        sourceId: payment.id,
        userId: req.user!.id,
        skipReference: true,
        lines: [
          { accountId: postingAccounts.apTradeId, debit: d(req.body.amount), description: `Payment ${reference}` },
          { accountId: pmAccount, credit: d(req.body.amount), description: `Payment ${reference} to ${supplier.name}` },
        ],
      });

      // Mark invoice as PAID if fully paid
      if (req.body.invoiceId) {
        if (invoice) {
          const paidTotal = d(invoice.amountPaid).plus(d(req.body.amount));
          await tx.supplierInvoice.update({
            where: { id: invoice.id },
            data: {
              amountPaid: paidTotal,
              status: paidTotal.gte(d(invoice.total)) ? "PAID" : "PARTIAL",
            },
          });
        }
      }

      await writeAudit(tx as any, {
        companyId,
        branchId,
        userId: req.user!.id,
        action: AuditAction.POST,
        entity: "SUPPLIER_PAYMENT",
        entityId: payment.id,
        afterJson: { reference, amount: req.body.amount },
        description: `Supplier payment ${reference} to ${supplier.name}`,
      });
      return { payment };
    }).then((r) => res.status(201).json(r));
  })
);

router.get(
  "/supplier-payments",
  requirePermission("purchase.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const where: Prisma.SupplierPaymentWhereInput = { companyId: req.user!.companyId };
    const branchId = effectiveBranchId(req);
    if (!req.user!.canViewAllBranches && branchId) where.branchId = branchId;
    if (req.query.supplierId as string) where.supplierId = req.query.supplierId as string;
    const [total, items] = await Promise.all([
      prisma.supplierPayment.count({ where }),
      prisma.supplierPayment.findMany({
        where,
        include: {
          supplier: { select: { id: true, name: true } },
          invoice: { select: { id: true, reference: true, docReference: true } },
          bankAccount: { select: { id: true, accountName: true, bankName: true } },
        },
        orderBy: { paymentDate: "desc" },
        skip,
        take: pageSize,
      }),
    ]);
    res.json({ items, total, page, pageSize });
  })
);

// Supplier statement
router.get(
  "/suppliers/:id/statement",
  requirePermission("report.view"),
  asyncHandler(async (req, res) => {
    const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id as string } });
    if (!supplier || supplier.companyId !== req.user!.companyId) throw ApiError.notFound("Supplier not found");

    const invoices = await prisma.supplierInvoice.findMany({
      where: { supplierId: supplier.id },
      orderBy: { invoiceDate: "asc" },
      select: { reference: true, docReference: true, invoiceDate: true, total: true, amountPaid: true },
    });
    const payments = await prisma.supplierPayment.findMany({
      where: { supplierId: supplier.id },
      orderBy: { paymentDate: "asc" },
      select: { reference: true, paymentDate: true, amount: true },
    });
    const refunds = await prisma.purchaseReturn.findMany({
      where: { supplierId: supplier.id },
      orderBy: { returnDate: "asc" },
      select: { reference: true, returnDate: true, total: true },
    });

    interface Row { date: Date; reference: string; type: string; debit: number; credit: number; balance: number }
    const rows: Row[] = [];
    let balance = d(0);
    for (const inv of invoices) {
      balance = balance.plus(inv.total);
      rows.push({ date: inv.invoiceDate, reference: inv.docReference ?? inv.reference, type: "INVOICE", debit: 0, credit: d(inv.total).toNumber(), balance: balance.toNumber() });
    }
    for (const p of payments) {
      balance = balance.minus(p.amount);
      rows.push({ date: p.paymentDate, reference: p.reference, type: "PAYMENT", debit: d(p.amount).toNumber(), credit: 0, balance: balance.toNumber() });
    }
    for (const r of refunds) {
      balance = balance.minus(r.total);
      rows.push({ date: r.returnDate, reference: r.reference, type: "CREDIT NOTE", debit: d(r.total).toNumber(), credit: 0, balance: balance.toNumber() });
    }
    rows.sort((a, b) => a.date.getTime() - b.date.getTime());
    res.json({ supplier, rows, closingBalance: balance.toNumber() });
  })
);

export default router;