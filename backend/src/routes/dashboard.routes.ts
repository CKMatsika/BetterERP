import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/handlers";
import { requirePermission, effectiveBranchId } from "../middleware/auth";
import { d, mul, div, sum } from "../utils/money";

const router = Router();

// GET /api/dashboard/summary
router.get(
  "/summary",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = effectiveBranchId(req);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const saleWhere: Prisma.SaleWhereInput = {
      companyId,
      status: { in: ["COMPLETED", "PARTIAL_RETURN"] },
    };
    if (!req.user!.canViewAllBranches && branchId) saleWhere.branchId = branchId;

    const todaySalesAgg = await prisma.sale.aggregate({
      where: { ...saleWhere, saleDate: { gte: todayStart, lte: todayEnd } },
      _sum: { total: true },
      _count: true,
    });
    const monthSalesAgg = await prisma.sale.aggregate({
      where: { ...saleWhere, saleDate: { gte: monthStart } },
      _sum: { total: true },
      _count: true,
    });

    // Inventory value
    const balanceWhere: Prisma.StockBalanceWhereInput = {};
    if (branchId) balanceWhere.warehouse = { branchId };
    const stockAgg = await prisma.stockBalance.aggregate({
      where: balanceWhere,
      _sum: { value: true, onHand: true },
    });

    // Products low on stock
    const lowStockRows = await prisma.stockBalance.findMany({
      where: {
        ...balanceWhere,
        product: { status: "ACTIVE", reorderLevel: { gt: 0 } },
      },
      select: { available: true, product: { select: { reorderLevel: true } } },
    });
    const lowStockCount = lowStockRows.filter((r) => r.available.lt(r.product.reorderLevel ?? 0)).length;

    // Purchase orders pending
    const poCount = await prisma.purchaseOrder.count({
      where: { companyId, status: { in: ["PENDING_APPROVAL", "APPROVED"] }, ...(branchId && !req.user!.canViewAllBranches ? { branchId } : {}) },
    });

    // Customers
    const customerCount = await prisma.customer.count({
      where: { companyId, ...(branchId && !req.user!.canViewAllBranches ? { branchId } : {}) },
    });

    // Receivables / payables
    const [arLines, apLines] = await Promise.all([
      prisma.journalLine.aggregate({
        where: { account: { companyId, code: "1301", isActive: true }, journalEntry: { companyId, posted: true, reversed: false } },
        _sum: { debit: true, credit: true },
      }),
      prisma.journalLine.aggregate({
        where: { account: { companyId, code: "2101", isActive: true }, journalEntry: { companyId, posted: true, reversed: false } },
        _sum: { debit: true, credit: true },
      }),
    ]);
    const receivable = d(arLines._sum.debit ?? 0).minus(d(arLines._sum.credit ?? 0));
    const payable = d(apLines._sum.credit ?? 0).minus(d(apLines._sum.debit ?? 0));

    res.json({
      today: { sales: d(todaySalesAgg._sum.total ?? 0).toNumber(), transactions: todaySalesAgg._count },
      month: { sales: d(monthSalesAgg._sum.total ?? 0).toNumber(), transactions: monthSalesAgg._count },
      inventory: {
        value: d(stockAgg._sum.value ?? 0).toNumber(),
        units: d(stockAgg._sum.onHand ?? 0).toNumber(),
      },
      lowStockItems: lowStockCount,
      pendingPurchaseOrders: poCount,
      customers: customerCount,
      receivables: receivable.toNumber(),
      payables: payable.toNumber(),
      branchId,
    });
  })
);

// Sales trend (for charts) - daily for last N days
router.get(
  "/sales-trend",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = effectiveBranchId(req);
    const days = Math.min(90, parseInt(req.query.days as string, 10) || 30);
    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    from.setHours(0, 0, 0, 0);

    const sales = await prisma.sale.findMany({
      where: {
        companyId,
        status: { in: ["COMPLETED", "PARTIAL_RETURN"] },
        saleDate: { gte: from },
        ...(!req.user!.canViewAllBranches && branchId ? { branchId } : {}),
      },
      select: { saleDate: true, total: true },
      orderBy: { saleDate: "asc" },
    });

    // Group by day
    const byDay = new Map<string, { date: string; sales: Prisma.Decimal; count: number }>();
    for (const s of sales) {
      const key = s.saleDate.toISOString().split("T")[0];
      const entry = byDay.get(key) ?? { date: key, sales: d(0), count: 0 };
      entry.sales = entry.sales.plus(d(s.total));
      entry.count += 1;
      byDay.set(key, entry);
    }

    // Fill gaps
    const result: any[] = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(from);
      date.setDate(date.getDate() + i);
      const key = date.toISOString().split("T")[0];
      const entry = byDay.get(key);
      result.push({
        date: key,
        sales: entry?.sales.toNumber() ?? 0,
        count: entry?.count ?? 0,
      });
    }

    res.json({ items: result });
  })
);

// Top selling products
router.get(
  "/top-products",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = effectiveBranchId(req);
    const limit = Math.min(20, parseInt(req.query.limit as string, 10) || 10);
    const since = req.query.since as string ? new Date(req.query.since as string) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const topProducts = await prisma.saleLine.groupBy({
      by: ["productId"],
      where: {
        sale: {
          companyId,
          status: { in: ["COMPLETED", "PARTIAL_RETURN"] },
          saleDate: { gte: since },
          ...(!req.user!.canViewAllBranches && branchId ? { branchId } : {}),
        },
      },
      _sum: { quantity: true, lineTotal: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: limit,
    });

    const productIds = topProducts.filter((t) => t.productId).map((t) => t.productId!);
    const products = productIds.length > 0
      ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, sku: true, name: true } })
      : [];
    const productMap = new Map(products.map((p) => [p.id, p]));

    res.json({
      items: topProducts.map((t) => ({
        product: t.productId ? productMap.get(t.productId) : null,
        quantity: d(t._sum.quantity ?? 0).toNumber(),
        revenue: d(t._sum.lineTotal ?? 0).toNumber(),
      })),
    });
  })
);

// Expenses for the period
router.get(
  "/expenses-summary",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = effectiveBranchId(req);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const expenses = await prisma.expense.aggregate({
      where: {
        companyId,
        status: "PAID",
        expenseDate: { gte: monthStart },
        ...(!req.user!.canViewAllBranches && branchId ? { branchId } : {}),
      },
      _sum: { amount: true },
    });

    res.json({ monthExpenses: d(expenses._sum.amount ?? 0).toNumber() });
  })
);

// Branch performance comparison (HQ only)
router.get(
  "/branch-performance",
  requirePermission("dashboard.view_all_branches"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const branches = await prisma.branch.findMany({
      where: { companyId, status: "ACTIVE" },
      select: { id: true, code: true, name: true },
    });

    const branchSales = await prisma.sale.groupBy({
      by: ["branchId"],
      where: {
        companyId,
        status: { in: ["COMPLETED", "PARTIAL_RETURN"] },
        saleDate: { gte: monthStart },
      },
      _sum: { total: true },
      _count: true,
    });
    const salesMap = new Map(branchSales.map((b) => [b.branchId, b]));

    const branchCustomers = await prisma.customer.groupBy({
      by: ["branchId"],
      where: { companyId, branchId: { not: null } },
      _count: true,
    });
    const custMap = new Map(branchCustomers.map((b) => [b.branchId, b._count]));

    res.json({
      items: branches.map((b) => ({
        ...b,
        monthSales: d(salesMap.get(b.id)?._sum.total ?? 0).toNumber(),
        saleCount: salesMap.get(b.id)?._count ?? 0,
        customers: custMap.get(b.id) ?? 0,
      })),
    });
  })
);

// Recent activity (latest notifications or transactions)
router.get(
  "/recent-sales",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = effectiveBranchId(req);
    const recent = await prisma.sale.findMany({
      where: {
        companyId,
        ...(!req.user!.canViewAllBranches && branchId ? { branchId } : {}),
      },
      include: {
        cashier: { select: { id: true, fullName: true, username: true } },
        customer: { select: { id: true, name: true } },
      },
      orderBy: { saleDate: "desc" },
      take: 10,
    });
    res.json({ items: recent });
  })
);

// Alerts: low stock, pending approvals, overdue invoices
router.get(
  "/alerts",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = effectiveBranchId(req);

    const lowStockRows = await prisma.stockBalance.findMany({
      where: {
        warehouse: { branch: { companyId }, ...(branchId ? { branchId } : {}) },
        product: { status: "ACTIVE", reorderLevel: { gt: 0 } },
      },
      include: { product: { select: { id: true, sku: true, name: true, reorderLevel: true } }, warehouse: { select: { name: true } } },
      orderBy: { available: "asc" },
    });
    const lowStockItems = lowStockRows
      .filter((s) => s.available.lt(s.product.reorderLevel ?? 0))
      .slice(0, 20)
      .map((s) => ({
        product: s.product,
        warehouse: s.warehouse.name,
        available: d(s.available).toNumber(),
        reorderLevel: d(s.product.reorderLevel ?? 0).toNumber(),
      }));

    const pendingApprovals = await prisma.approvalRequest.count({
      where: {
        companyId,
        status: "PENDING",
        ...(branchId && !req.user!.canViewAllBranches ? { branchId } : {}),
      },
    });

    const overdueInvoices = await prisma.supplierInvoice.count({
      where: {
        companyId,
        status: { in: ["OPEN", "PARTIAL", "OVERDUE"] },
        dueDate: { lt: new Date() },
        ...(branchId && !req.user!.canViewAllBranches ? { branchId } : {}),
      },
    });

    res.json({
      lowStock: lowStockItems.length,
      lowStockItems,
      pendingApprovals,
      overdueInvoices,
    });
  })
);

export default router;