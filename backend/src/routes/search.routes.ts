import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler, parsePagination } from "../utils/handlers";
import { requirePermission, effectiveBranchId } from "../middleware/auth";
import { d } from "../utils/money";

const router = Router();

// GET /api/search?q=&type=  - global search across configured entities
router.get(
  "/",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    const q = (req.query.q as string) ?? "";
    const entities = (req.query.type as string) ? (req.query.type as string).split(",") : ["products", "customers", "suppliers", "employees"];
    const companyId = req.user!.companyId;
    const branchId = effectiveBranchId(req);

    const results: Record<string, any[]> = {};
    const limit = 10;

    if (!q.trim()) return res.json({ items: results });

    const contains = { contains: q, mode: "insensitive" as const };

    if (entities.includes("products")) {
      const products = await prisma.product.findMany({
        where: {
          companyId,
          OR: [{ sku: contains }, { barcode: contains }, { name: contains }],
        },
        select: { id: true, sku: true, name: true, sellingPrice: true, status: true },
        take: limit,
      });
      results.products = products;
    }

    if (entities.includes("customers")) {
      const customers = await prisma.customer.findMany({
        where: {
          companyId,
          ...(!req.user!.canViewAllBranches && branchId ? { branchId } : {}),
          OR: [{ name: contains }, { phone: contains }, { email: contains }, { code: contains }],
        },
        select: { id: true, code: true, name: true, phone: true, email: true },
        take: limit,
      });
      results.customers = customers;
    }

    if (entities.includes("suppliers")) {
      const suppliers = await prisma.supplier.findMany({
        where: {
          companyId,
          OR: [{ name: contains }, { phone: contains }, { email: contains }],
        },
        select: { id: true, code: true, name: true, phone: true, email: true },
        take: limit,
      });
      results.suppliers = suppliers;
    }

    if (entities.includes("employees")) {
      const employees = await prisma.employee.findMany({
        where: {
          companyId,
          ...(!req.user!.canViewAllBranches && branchId ? { branchId } : {}),
          OR: [
            { firstName: contains },
            { lastName: contains },
            { employeeNumber: contains },
            { nationalId: contains },
          ],
        },
        select: { id: true, employeeNumber: true, firstName: true, lastName: true, phone: true },
        take: limit,
      });
      results.employees = employees;
    }

    if (entities.includes("users")) {
      const users = await prisma.user.findMany({
        where: {
          companyId,
          OR: [{ username: contains }, { fullName: contains }, { email: contains }],
        },
        select: { id: true, username: true, fullName: true, email: true, isActive: true },
        take: limit,
      });
      results.users = users;
    }

    if (entities.includes("sales")) {
      const sales = await prisma.sale.findMany({
        where: {
          companyId,
          reference: contains,
          ...(!req.user!.canViewAllBranches && branchId ? { branchId } : {}),
        },
        select: { id: true, reference: true, type: true, total: true, saleDate: true },
        orderBy: { saleDate: "desc" },
        take: limit,
      });
      results.sales = sales;
    }

    if (entities.includes("purchases")) {
      const pos = await prisma.purchaseOrder.findMany({
        where: { companyId, reference: contains },
        select: { id: true, reference: true, status: true, total: true, orderDate: true },
        take: limit,
      });
      results.purchases = pos;
    }

    res.json({ items: results, query: q });
  })
);

// Barcode lookup - used by POS
router.get(
  "/barcode/:barcode",
  requirePermission("pos.view"),
  asyncHandler(async (req, res) => {
    const barcode = req.params.barcode as string;
    const product = await prisma.product.findFirst({
      where: { companyId: req.user!.companyId, barcode, status: "ACTIVE" },
      include: {
        category: { select: { id: true, name: true } },
        taxRate: { select: { id: true, rate: true, name: true } },
      },
    });
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json(product);
  })
);

export default router;