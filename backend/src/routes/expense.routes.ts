import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { asyncHandler, parsePagination } from "../utils/handlers";
import { validateBody } from "../middleware/validate";
import { requirePermission, effectiveBranchId } from "../middleware/auth";
import { postJournal } from "../services/accounting.service";
import { getPostingAccounts } from "../services/postingAccounts.service";
import { nextReference } from "../services/sequence.service";
import { writeAudit } from "../services/audit.service";
import { AuditAction } from "@prisma/client";
import { d } from "../utils/money";

const router = Router();

// ==================== EXPENSE CATEGORIES ====================

router.get(
  "/categories",
  requirePermission("expense.view"),
  asyncHandler(async (req, res) => {
    const categories = await prisma.expenseCategory.findMany({
      where: { companyId: req.user!.companyId },
      include: { account: { select: { id: true, code: true, name: true } } },
      orderBy: { name: "asc" },
    });
    res.json({ items: categories });
  })
);

router.post(
  "/categories",
  requirePermission("expense.create"),
  validateBody(z.object({ name: z.string().min(1), accountId: z.string().optional().nullable() })),
  asyncHandler(async (req, res) => {
    const existing = await prisma.expenseCategory.findUnique({
      where: { companyId_name: { companyId: req.user!.companyId, name: req.body.name } },
    });
    if (existing) throw ApiError.badRequest("Category name already exists");
    const category = await prisma.expenseCategory.create({
      data: { companyId: req.user!.companyId, ...req.body },
    });
    res.status(201).json(category);
  })
);

router.put(
  "/categories/:id",
  requirePermission("expense.create"),
  validateBody(z.object({ name: z.string().optional(), accountId: z.string().optional().nullable() })),
  asyncHandler(async (req, res) => {
    const category = await prisma.expenseCategory.findUnique({ where: { id: req.params.id as string } });
    if (!category || category.companyId !== req.user!.companyId) throw ApiError.notFound("Category not found");
    const updated = await prisma.expenseCategory.update({ where: { id: category.id }, data: req.body });
    res.json(updated);
  })
);

// ==================== EXPENSES ====================

const expenseSchema = z.object({
  categoryId: z.string().optional().nullable(),
  description: z.string().min(1),
  amount: z.coerce.number().positive(),
  taxAmount: z.coerce.number().min(0).optional(),
  currency: z.string().optional(),
  exchangeRate: z.coerce.number().positive().optional(),
  supplierId: z.string().optional().nullable(),
  paymentMethod: z.string().optional().nullable(),
  bankAccountId: z.string().optional().nullable(),
  paidById: z.string().optional().nullable(),
  expenseDate: z.coerce.date().optional(),
  branchId: z.string().optional(),
  note: z.string().optional(),
});

router.get(
  "/",
  requirePermission("expense.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const where: Prisma.ExpenseWhereInput = { companyId: req.user!.companyId };
    const branchId = effectiveBranchId(req);
    if (!req.user!.canViewAllBranches && branchId) where.branchId = branchId;
    if (req.query.branchId as string) where.branchId = req.query.branchId as string;
    if (req.query.status as string) where.status = req.query.status as string;
    if (req.query.categoryId as string) where.categoryId = req.query.categoryId as string;
    if (req.query.from as string || req.query.to as string) {
      where.expenseDate = {
        gte: req.query.from as string ? new Date(req.query.from as string) : undefined,
        lte: req.query.to as string ? new Date(new Date(req.query.to as string).getTime() + 86400000 - 1) : undefined,
      };
    }
    if (req.query.search as string) {
      where.OR = [
        { description: { contains: req.query.search as string, mode: "insensitive" } },
        { reference: { contains: req.query.search as string, mode: "insensitive" } },
      ];
    }
    const [total, items] = await Promise.all([
      prisma.expense.count({ where }),
      prisma.expense.findMany({
        where,
        include: {
          expenseCategory: { select: { id: true, name: true } },
          paidBy: { select: { id: true, fullName: true, username: true } },
        },
        orderBy: { expenseDate: "desc" },
        skip,
        take: pageSize,
      }),
    ]);
    res.json({ items, total, page, pageSize });
  })
);

router.get(
  "/:id",
  requirePermission("expense.view"),
  asyncHandler(async (req, res) => {
    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id as string },
      include: { expenseCategory: true, paidBy: { select: { id: true, fullName: true } } },
    });
    if (!expense || expense.companyId !== req.user!.companyId) throw ApiError.notFound("Expense not found");
    res.json(expense);
  })
);

router.post(
  "/",
  requirePermission("expense.create"),
  validateBody(expenseSchema),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = req.body.branchId ?? req.user!.branchId!;
    return prisma.$transaction(async (tx) => {
      const reference = await nextReference({ companyId, branchId, docType: "EXPENSE" });
      const expense = await tx.expense.create({
        data: {
          companyId,
          branchId,
          reference,
          ...req.body,
          status: "PENDING",
          createdById: req.user!.id,
        },
      });
      await writeAudit(tx as any, {
        companyId,
        branchId,
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entity: "EXPENSE",
        entityId: expense.id,
        afterJson: { reference, amount: req.body.amount },
      });
      return expense;
    }).then((r) => res.status(201).json(r));
  })
);

router.put(
  "/:id",
  requirePermission("expense.create"),
  validateBody(expenseSchema.partial()),
  asyncHandler(async (req, res) => {
    const expense = await prisma.expense.findUnique({ where: { id: req.params.id as string } });
    if (!expense || expense.companyId !== req.user!.companyId) throw ApiError.notFound("Expense not found");
    if (expense.posted) throw ApiError.badRequest("Cannot edit posted expense");
    const updated = await prisma.expense.update({ where: { id: expense.id }, data: req.body });
    res.json(updated);
  })
);

// Approve expense
router.post(
  "/:id/approve",
  requirePermission("expense.approve"),
  asyncHandler(async (req, res) => {
    const expense = await prisma.expense.findUnique({ where: { id: req.params.id as string } });
    if (!expense || expense.companyId !== req.user!.companyId) throw ApiError.notFound("Expense not found");
    if (expense.status !== "PENDING") throw ApiError.badRequest("Expense is not pending approval");
    const updated = await prisma.expense.update({
      where: { id: expense.id },
      data: { status: "APPROVED", approvedById: req.user!.id, approvedAt: new Date() },
    });
    res.json(updated);
  })
);

// Post approved expense to GL
router.post(
  "/:id/post",
  requirePermission("expense.approve"),
  asyncHandler(async (req, res) => {
    const expense = await prisma.expense.findUnique({ where: { id: req.params.id as string } });
    if (!expense || expense.companyId !== req.user!.companyId) throw ApiError.notFound("Expense not found");
    if (expense.status !== "APPROVED") throw ApiError.badRequest("Only approved expenses can be posted");
    if (expense.posted) throw ApiError.badRequest("Expense already posted");

    return prisma.$transaction(async (tx) => {
      const postingAccounts = await getPostingAccounts(tx as any, expense.companyId, expense.branchId);
      // Determine expense account from category
      let expenseAccountId = postingAccounts.otherExpenses;
      if (expense.categoryId) {
        const cat = await tx.expenseCategory.findUnique({ where: { id: expense.categoryId } });
        if (cat?.accountId) expenseAccountId = cat.accountId;
      }

      const totalAmount = d(expense.amount).plus(d(expense.taxAmount ?? 0));
      const journalLines: any[] = [
        { accountId: expenseAccountId, debit: totalAmount, description: expense.description },
      ];

      // Bank account (if paid from bank) or cash
      if (expense.bankAccountId) {
        const bankAcc = await tx.bankAccount.findUnique({ where: { id: expense.bankAccountId } });
        journalLines.push({ accountId: bankAcc?.accountId ?? postingAccounts.bankAccountId, credit: totalAmount, description: expense.description });
      } else {
        journalLines.push({ accountId: postingAccounts.cashAccountId, credit: totalAmount, description: expense.description });
      }

      await postJournal(tx as any, {
        companyId: expense.companyId,
        branchId: expense.branchId,
        reference: `EXP-${expense.reference}`,
        description: `Expense: ${expense.description}`,
        entryType: "EXPENSE",
        sourceType: "EXPENSE",
        sourceId: expense.id,
        userId: req.user!.id,
        skipReference: true,
        lines: journalLines,
      });

      await tx.expense.update({
        where: { id: expense.id },
        data: { posted: true, postedAt: new Date(), status: "PAID" },
      });

      return res.json({ success: true });
    }).then((r) => r);
  })
);

// ==================== PETTY CASH ====================

router.get(
  "/petty-cash",
  requirePermission("expense.view"),
  asyncHandler(async (req, res) => {
    const where: Prisma.PettyCashWhereInput = { companyId: req.user!.companyId };
    const branchId = effectiveBranchId(req);
    if (!req.user!.canViewAllBranches && branchId) where.branchId = branchId;
    const items = await prisma.pettyCash.findMany({ where, orderBy: { name: "asc" } });
    res.json({ items });
  })
);

router.post(
  "/petty-cash",
  requirePermission("expense.create"),
  validateBody(z.object({ name: z.string().min(1), branchId: z.string(), topUpAmount: z.coerce.number().positive().optional() })),
  asyncHandler(async (req, res) => {
    const pc = await prisma.pettyCash.create({
      data: { companyId: req.user!.companyId, ...req.body, balance: req.body.topUpAmount ?? 0 },
    });
    res.status(201).json(pc);
  })
);

export default router;