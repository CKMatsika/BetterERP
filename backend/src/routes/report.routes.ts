import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { asyncHandler } from "../utils/handlers";
import { requirePermission, effectiveBranchId } from "../middleware/auth";
import { d, sum } from "../utils/money";

const router = Router();

// Helper to convert JSON rows to CSV
const toCsv = (rows: Record<string, any>[]): string => {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
};

const sendCsv = (res: any, filename: string, rows: Record<string, any>[]) => {
  const csv = toCsv(rows);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
  res.send(csv);
};

// ==================== INVENTORY REPORTS ====================

router.get(
  "/inventory/valuation",
  requirePermission("report.view"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = effectiveBranchId(req);
    const where: Prisma.StockBalanceWhereInput = {
      warehouse: { branch: { companyId }, ...(branchId && !req.user!.canViewAllBranches ? { branchId } : {}) },
      onHand: { gt: 0 },
    };
    const balances = await prisma.stockBalance.findMany({
      where,
      include: {
        product: { select: { id: true, sku: true, name: true, averageCost: true } },
        warehouse: { select: { code: true, name: true } },
      },
      orderBy: { warehouse: { code: "asc" } },
    });
    const rows = balances.map((b) => ({
      Warehouse: b.warehouse.code,
      SKU: b.product.sku,
      Product: b.product.name,
      "On Hand": d(b.onHand).toNumber(),
      "Avg Cost": d(b.averageCost).toNumber(),
      Value: d(b.value).toNumber(),
    }));
    const totalValue = sum(rows.map((r) => r.Value));
    if (req.query.format as string === "csv") {
      const exportRows = [...rows, { Warehouse: "", SKU: "", Product: "TOTAL", "On Hand": "", "Avg Cost": "", Value: totalValue.toNumber() }];
      return sendCsv(res, "inventory_valuation", exportRows);
    }
    res.json({ items: rows, totalValue: totalValue.toNumber() });
  })
);

router.get(
  "/inventory/movement",
  requirePermission("report.view"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const where: Prisma.StockMovementWhereInput = { companyId };
    const branchId = effectiveBranchId(req);
    if (!req.user!.canViewAllBranches && branchId) where.branchId = branchId;
    if (req.query.productId as string) where.productId = req.query.productId as string;
    if (req.query.type as string) where.type = req.query.type as any;
    if (req.query.from as string || req.query.to as string) {
      where.createdAt = {
        gte: req.query.from as string ? new Date(req.query.from as string) : undefined,
        lte: req.query.to as string ? new Date(new Date(req.query.to as string).getTime() + 86400000 - 1) : undefined,
      };
    }
    const movements = await prisma.stockMovement.findMany({
      where,
      include: { product: { select: { sku: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const rows = movements.map((m) => ({
      Date: m.createdAt.toISOString(),
      Reference: m.reference,
      Type: m.type,
      SKU: m.product.sku,
      Product: m.product.name,
      Quantity: d(m.quantity).toNumber(),
      "Unit Cost": d(m.unitCost ?? 0).toNumber(),
    }));
    if (req.query.format as string === "csv") return sendCsv(res, "inventory_movement", rows);
    res.json({ items: rows });
  })
);

router.get(
  "/inventory/stock-levels",
  requirePermission("report.view"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = effectiveBranchId(req);
    const products = await prisma.product.findMany({
      where: { companyId, status: "ACTIVE" },
      select: { id: true, sku: true, name: true, reorderLevel: true, minimumStock: true, maximumStock: true, averageCost: true },
    });
    const groupBy = await prisma.stockBalance.groupBy({
      by: ["productId"],
      where: {
        productId: { in: products.map((p) => p.id) },
        warehouse: { branch: { companyId }, ...(branchId && !req.user!.canViewAllBranches ? { branchId } : {}) },
      },
      _sum: { onHand: true, available: true, value: true },
    });
    const map = new Map(groupBy.map((g) => [g.productId, g._sum]));
    const rows = products.map((p) => {
      const s = map.get(p.id);
      const onHand = d(s?.onHand ?? 0);
      return {
        SKU: p.sku,
        Product: p.name,
        "On Hand": onHand.toNumber(),
        Available: d(s?.available ?? 0).toNumber(),
        "Reorder Level": d(p.reorderLevel ?? 0).toNumber(),
        Status: onHand.lessThanOrEqualTo(d(p.reorderLevel ?? 0)) ? "LOW" : onHand.greaterThan(d(p.maximumStock ?? 1e9)) ? "OVER" : "OK",
        Value: d(s?.value ?? 0).toNumber(),
      };
    });
    if (req.query.format as string === "csv") return sendCsv(res, "inventory_stock_levels", rows);
    res.json({ items: rows });
  })
);

// ==================== SALES REPORTS ====================

router.get(
  "/sales",
  requirePermission("report.view"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = effectiveBranchId(req);
    const where: Prisma.SaleWhereInput = { companyId, status: { in: ["COMPLETED", "PARTIAL_RETURN"] } };
    if (!req.user!.canViewAllBranches && branchId) where.branchId = branchId;
    if (req.query.branchId as string) where.branchId = req.query.branchId as string;
    if (req.query.from as string || req.query.to as string) {
      where.saleDate = {
        gte: req.query.from as string ? new Date(req.query.from as string) : undefined,
        lte: req.query.to as string ? new Date(new Date(req.query.to as string).getTime() + 86400000 - 1) : undefined,
      };
    }
    const sales = await prisma.sale.findMany({
      where,
      include: { cashier: { select: { fullName: true } }, lines: { select: { id: true } } },
      orderBy: { saleDate: "desc" },
      take: 1000,
    });
    const rows = sales.map((s) => ({
      Date: s.saleDate.toISOString(),
      Reference: s.reference,
      Type: s.type,
      "Sale Qty": s.lines.length,
      Subtotal: d(s.subtotal).toNumber(),
      Discount: d(s.discount).toNumber(),
      Tax: d(s.taxAmount).toNumber(),
      Total: d(s.total).toNumber(),
      Cashier: s.cashier.fullName,
    }));
    const total = sum(rows.map((r) => r.Total));
    if (req.query.format as string === "csv") {
      const exportRows = [...rows, { Date: "", Reference: "", Type: "", "Sale Qty": "", Subtotal: "", Discount: "", Tax: "", Total: total.toNumber(), Cashier: "TOTAL" }];
      return sendCsv(res, "sales_report", exportRows);
    }
    res.json({ items: rows, total: total.toNumber() });
  })
);

router.get(
  "/sales/by-product",
  requirePermission("report.view"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = effectiveBranchId(req);
    const since = req.query.from as string ? new Date(req.query.from as string) : new Date(new Date().getFullYear(), 0, 1);
    const to = req.query.to as string ? new Date(new Date(req.query.to as string).getTime() + 86400000 - 1) : new Date();

    const groups = await prisma.saleLine.groupBy({
      by: ["productId"],
      where: {
        sale: {
          companyId,
          status: { in: ["COMPLETED", "PARTIAL_RETURN"] },
          saleDate: { gte: since, lte: to },
          ...(!req.user!.canViewAllBranches && branchId ? { branchId } : {}),
        },
      },
      _sum: { quantity: true, lineTotal: true, costPrice: true },
      _count: true,
    });
    const productIds = groups.filter((g) => g.productId).map((g) => g.productId!);
    const products = productIds.length > 0 ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, sku: true, name: true } }) : [];
    const productMap = new Map(products.map((p) => [p.id, p]));

    const rows = groups.map((g) => {
      const revenue = d(g._sum.lineTotal ?? 0);
      const cost = d(g._sum.costPrice ?? 0);
      return {
        SKU: g.productId ? productMap.get(g.productId)?.sku ?? "" : "",
        Product: g.productId ? productMap.get(g.productId)?.name ?? "" : "",
        Qty: d(g._sum.quantity ?? 0).toNumber(),
        "Unit Price": g._sum.quantity && !d(g._sum.quantity).isZero() ? revenue.div(d(g._sum.quantity)).toNumber() : 0,
        Revenue: revenue.toNumber(),
        Cost: cost.toNumber(),
        Profit: revenue.minus(cost).toNumber(),
      };
    });
    if (req.query.format as string === "csv") return sendCsv(res, "sales_by_product", rows);
    res.json({ items: rows });
  })
);

router.get(
  "/sales/by-cashier",
  requirePermission("report.view"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = effectiveBranchId(req);
    const since = req.query.from as string ? new Date(req.query.from as string) : new Date(new Date().getFullYear(), 0, 1);
    const to = req.query.to as string ? new Date(new Date(req.query.to as string).getTime() + 86400000 - 1) : new Date();

    const groups = await prisma.sale.groupBy({
      by: ["cashierId"],
      where: {
        companyId,
        status: { in: ["COMPLETED", "PARTIAL_RETURN"] },
        saleDate: { gte: since, lte: to },
        ...(!req.user!.canViewAllBranches && branchId ? { branchId } : {}),
      },
      _sum: { total: true },
      _count: true,
    });
    const cashierIds = groups.map((g) => g.cashierId);
    const cashiers = await prisma.user.findMany({ where: { id: { in: cashierIds } }, select: { id: true, fullName: true, username: true } });
    const cashierMap = new Map(cashiers.map((c) => [c.id, c]));

    const rows = groups.map((g) => ({
      Cashier: cashierMap.get(g.cashierId)?.fullName ?? g.cashierId,
      "Username": cashierMap.get(g.cashierId)?.username ?? "",
      Transactions: g._count,
      Total: d(g._sum.total ?? 0).toNumber(),
    }));
    if (req.query.format as string === "csv") return sendCsv(res, "sales_by_cashier", rows);
    res.json({ items: rows });
  })
);

// ==================== PROCUREMENT REPORTS ====================

router.get(
  "/procurement",
  requirePermission("report.view"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = effectiveBranchId(req);
    const where: Prisma.PurchaseOrderWhereInput = { companyId };
    if (!req.user!.canViewAllBranches && branchId) where.branchId = branchId;
    if (req.query.status as string) where.status = req.query.status as any;
    if (req.query.from as string || req.query.to as string) {
      where.orderDate = {
        gte: req.query.from as string ? new Date(req.query.from as string) : undefined,
        lte: req.query.to as string ? new Date(new Date(req.query.to as string).getTime() + 86400000 - 1) : undefined,
      };
    }
    const pos = await prisma.purchaseOrder.findMany({
      where,
      include: { supplier: { select: { name: true } } },
      orderBy: { orderDate: "desc" },
      take: 500,
    });
    const rows = pos.map((p) => ({
      Date: p.orderDate.toISOString(),
      Reference: p.reference,
      Supplier: p.supplier.name,
      Status: p.status,
      Subtotal: d(p.subtotal).toNumber(),
      Tax: d(p.taxAmount).toNumber(),
      Total: d(p.total).toNumber(),
    }));
    if (req.query.format as string === "csv") return sendCsv(res, "procurement_report", rows);
    res.json({ items: rows });
  })
);

router.get(
  "/procurement/supplier-performance",
  requirePermission("report.view"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const suppliers = await prisma.supplier.findMany({
      where: { companyId },
      include: { purchaseOrders: { select: { total: true, status: true } } },
    });
    const rows = suppliers.map((s) => {
      const orders = s.purchaseOrders;
      const totalSpend = sum(orders.map((o) => d(o.total)));
      return {
        Supplier: s.name,
        "Total Orders": orders.length,
        "Total Spend": totalSpend.toNumber(),
      };
    });
    if (req.query.format as string === "csv") return sendCsv(res, "supplier_performance", rows);
    res.json({ items: rows });
  })
);

// ==================== ACCOUNTING REPORTS ====================

router.get(
  "/accounting/general-ledger",
  requirePermission("report.financial"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const accountId = req.query.accountId as string | undefined;
    const where: Prisma.JournalLineWhereInput = {
      journalEntry: { companyId, posted: true, reversed: false },
      ...(accountId ? { accountId } : {}),
    };
    if (req.query.from as string || req.query.to as string) {
      where.journalEntry = where.journalEntry as any;
      (where.journalEntry as any).entryDate = {
        gte: req.query.from as string ? new Date(req.query.from as string) : undefined,
        lte: req.query.to as string ? new Date(new Date(req.query.to as string).getTime() + 86400000 - 1) : undefined,
      };
    }
    const lines = await prisma.journalLine.findMany({
      where,
      include: { account: { select: { code: true, name: true } }, journalEntry: { select: { reference: true, description: true, entryDate: true } } },
      orderBy: { journalEntry: { entryDate: "asc" } },
      take: 1000,
    });
    const rows = lines.map((l) => ({
      Date: l.journalEntry.entryDate.toISOString(),
      Reference: l.journalEntry.reference,
      Description: l.description ?? l.journalEntry.description ?? "",
      "Account Code": l.account.code,
      Account: l.account.name,
      Debit: d(l.debit).toNumber(),
      Credit: d(l.credit).toNumber(),
    }));
    if (req.query.format as string === "csv") return sendCsv(res, "general_ledger", rows);
    res.json({ items: rows });
  })
);

router.get(
  "/accounting/aged-recivables",
  requirePermission("report.financial"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    // Aggregate AR by customer from sale records
    const creditSales = await prisma.sale.findMany({
      where: { companyId, isCredit: true, status: { in: ["COMPLETED", "PARTIAL_RETURN"] } },
      include: { customer: true, payments: true },
    });
    const today = new Date();
    const buckets = ["0-30", "31-60", "61-90", "90+"];
    const customers = new Map<string, any>();

    for (const sale of creditSales) {
      if (!sale.customerId) continue;
      const paid = d(sale.payments.reduce((acc, r) => acc.plus(d(r.amount)), d(0)));
      const outstanding = d(sale.total).minus(paid);
      if (outstanding.isNegative() || outstanding.isZero()) continue;

      const days = Math.floor((today.getTime() - new Date(sale.creditDueDate ?? sale.saleDate).getTime()) / 86400000);
      const bucket = days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";

      const entry = customers.get(sale.customerId) ?? {
        Customer: sale.customer?.name ?? "",
        "0-30": d(0),
        "31-60": d(0),
        "61-90": d(0),
        "90+": d(0),
        Total: d(0),
      };
      entry[bucket] = entry[bucket].plus(outstanding);
      entry.Total = entry.Total.plus(outstanding);
      customers.set(sale.customerId, entry);
    }

    const rows = Array.from(customers.values()).map((c) => ({
      Customer: c.Customer,
      "0-30": c["0-30"].toNumber(),
      "31-60": c["31-60"].toNumber(),
      "61-90": c["61-90"].toNumber(),
      "90+": c["90+"].toNumber(),
      Total: c.Total.toNumber(),
    }));
    if (req.query.format as string === "csv") return sendCsv(res, "aged_receivables", rows);
    res.json({ items: rows });
  })
);

// ==================== HR REPORTS ====================

router.get(
  "/hr/headcount",
  requirePermission("report.view"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const employees = await prisma.employee.findMany({
      where: { companyId, employmentStatus: "ACTIVE" },
      include: { department: { select: { name: true } }, branch: { select: { name: true } } },
    });
    const byDepartment = new Map<string, number>();
    const byBranch = new Map<string, number>();
    employees.forEach((e) => {
      byDepartment.set(e.department?.name ?? "Unassigned", (byDepartment.get(e.department?.name ?? "Unassigned") ?? 0) + 1);
      byBranch.set(e.branch?.name ?? "Unassigned", (byBranch.get(e.branch?.name ?? "Unassigned") ?? 0) + 1);
    });
    res.json({
      total: employees.length,
      byDepartment: Array.from(byDepartment.entries()).map(([name, count]) => ({ name, count })),
      byBranch: Array.from(byBranch.entries()).map(([name, count]) => ({ name, count })),
    });
  })
);

router.get(
  "/hr/attendance-summary",
  requirePermission("report.view"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const from = req.query.from as string ? new Date(req.query.from as string) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const to = req.query.to as string ? new Date(req.query.to as string) : new Date();
    const attendance = await prisma.attendance.findMany({
      where: { companyId, date: { gte: from, lte: to } },
    });
    const byStatus = new Map<string, number>();
    const byDay = new Map<string, number>();
    attendance.forEach((a) => {
      byStatus.set(a.status, (byStatus.get(a.status) ?? 0) + 1);
      const day = a.date.toISOString().split("T")[0];
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    });
    res.json({
      total: attendance.length,
      byStatus: Array.from(byStatus.entries()).map(([status, count]) => ({ status, count })),
      byDay: Array.from(byDay.entries()).map(([date, count]) => ({ date, count })),
    });
  })
);

export default router;