import { Router } from "express";
import { z } from "zod";
import { Prisma, AccountType, AccountNormalBalance } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { asyncHandler, parsePagination } from "../utils/handlers";
import { validateBody } from "../middleware/validate";
import { requirePermission, effectiveBranchId } from "../middleware/auth";
import { postJournal, reverseJournal, getAccountBalance } from "../services/accounting.service";
import { writeAudit } from "../services/audit.service";
import { AuditAction } from "@prisma/client";
import { d, sum, sub, isZero } from "../utils/money";

const router = Router();

// ==================== CHART OF ACCOUNTS ====================

const accountSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1),
  type: z.nativeEnum(AccountType),
  category: z.string().optional().nullable(),
  normalBalance: z.nativeEnum(AccountNormalBalance),
  currency: z.string().optional(),
  parentId: z.string().optional().nullable(),
  isControl: z.boolean().optional(),
  description: z.string().optional().nullable(),
  openingBalance: z.coerce.number().optional(),
  branchId: z.string().optional().nullable(),
});

router.get(
  "/accounts",
  requirePermission("accounting.view"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const where: Prisma.AccountWhereInput = { companyId };
    const branchId = effectiveBranchId(req);
    if (req.query.branchId as string) where.branchId = req.query.branchId as string;
    else if (branchId && !req.user!.canViewAllBranches) where.branchId = branchId;
    if (req.query.type as string) where.type = req.query.type as any;
    if (req.query.active as string !== undefined) where.isActive = req.query.active as string === "true";
    if (req.query.search as string) {
      const q = req.query.search as string;
      where.OR = [
        { code: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
      ];
    }

    const accounts = await prisma.account.findMany({
      where,
      include: { children: { select: { id: true, code: true, name: true, type: true } } },
      orderBy: { code: "asc" },
    });
    res.json({ items: accounts });
  })
);

router.get(
  "/accounts/tree",
  requirePermission("accounting.view"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const accounts = await prisma.account.findMany({
      where: { companyId, isActive: true },
      orderBy: { code: "asc" },
    });
    const map = new Map<string, any & { children: any[] }>();
    accounts.forEach((a) => map.set(a.id, { ...a, children: [] }));
    const roots: any[] = [];
    accounts.forEach((a) => {
      if (a.parentId && map.has(a.parentId)) map.get(a.parentId).children.push(map.get(a.id));
      else roots.push(map.get(a.id));
    });
    res.json(roots);
  })
);

router.post(
  "/accounts",
  requirePermission("account.inventory"),
  validateBody(accountSchema),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const existing = await prisma.account.findFirst({
      where: { companyId, branchId: req.body.branchId ?? null, code: req.body.code },
    });
    if (existing) throw ApiError.badRequest(`Account code ${req.body.code} already exists`);
    const account = await prisma.account.create({
      data: { companyId, ...req.body },
    });
    await writeAudit(prisma as any, {
      companyId,
      branchId: req.body.branchId ?? null,
      userId: req.user!.id,
      action: AuditAction.CREATE,
      entity: "ACCOUNT",
      entityId: account.id,
      afterJson: { code: account.code, name: account.name },
      description: `Created account ${account.code}`,
    });
    res.status(201).json(account);
  })
);

router.put(
  "/accounts/:id",
  requirePermission("account.inventory"),
  validateBody(accountSchema.partial()),
  asyncHandler(async (req, res) => {
    const account = await prisma.account.findUnique({ where: { id: req.params.id as string } });
    if (!account || account.companyId !== req.user!.companyId) throw ApiError.notFound("Account not found");
    const updated = await prisma.account.update({ where: { id: account.id }, data: req.body });
    res.json(updated);
  })
);

// ==================== JOURNAL ENTRIES ====================

const journalSchema = z.object({
  reference: z.string().optional(),
  description: z.string().min(1),
  entryType: z.string().default("MANUAL"),
  branchId: z.string().optional().nullable(),
  entryDate: z.coerce.date().optional(),
  sourceType: z.string().optional(),
  sourceId: z.string().optional(),
  lines: z.array(z.object({
    accountId: z.string(),
    debit: z.coerce.number().min(0).optional(),
    credit: z.coerce.number().min(0).optional(),
    description: z.string().optional(),
    branchId: z.string().optional().nullable(),
    departmentId: z.string().optional().nullable(),
    costCentreId: z.string().optional().nullable(),
    profitCentreId: z.string().optional().nullable(),
  })).min(2),
});

router.get(
  "/journals",
  requirePermission("accounting.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const companyId = req.user!.companyId;
    const where: Prisma.JournalEntryWhereInput = { companyId };
    if (req.query.branchId as string) where.branchId = req.query.branchId as string;
    if (req.query.entryType as string) where.entryType = req.query.entryType as string;
    if (req.query.from as string || req.query.to as string) {
      where.entryDate = {
        gte: req.query.from as string ? new Date(req.query.from as string) : undefined,
        lte: req.query.to as string ? new Date(new Date(req.query.to as string).getTime() + 86400000 - 1) : undefined,
      };
    }
    if (req.query.search as string) {
      where.OR = [
        { reference: { contains: req.query.search as string, mode: "insensitive" } },
        { description: { contains: req.query.search as string, mode: "insensitive" } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.journalEntry.count({ where }),
      prisma.journalEntry.findMany({
        where,
        include: {
          lines: { include: { account: { select: { id: true, code: true, name: true } } } },
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
  "/journals/:id",
  requirePermission("accounting.view"),
  asyncHandler(async (req, res) => {
    const entry = await prisma.journalEntry.findUnique({
      where: { id: req.params.id as string },
      include: { lines: { include: { account: { select: { id: true, code: true, name: true } } } } },
    });
    if (!entry || entry.companyId !== req.user!.companyId) throw ApiError.notFound("Journal entry not found");
    res.json(entry);
  })
);

router.post(
  "/journals",
  requirePermission("accounting.journal_create"),
  validateBody(journalSchema),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = req.body.branchId ?? req.user!.branchId;
    const entryId = await postJournal(prisma as any, {
      companyId,
      branchId,
      reference: req.body.reference,
      description: req.body.description,
      entryType: req.body.entryType,
      sourceType: req.body.sourceType,
      sourceId: req.body.sourceId,
      entryDate: req.body.entryDate,
      userId: req.user!.id,
      lines: req.body.lines,
    });
    await writeAudit(prisma as any, {
      companyId,
      branchId,
      userId: req.user!.id,
      action: AuditAction.POST,
      entity: "JOURNAL_ENTRY",
      entityId: entryId,
      description: `Posted journal ${req.body.description}`,
    });
    res.status(201).json({ id: entryId, reference: req.body.reference });
  })
);

router.post(
  "/journals/:id/reverse",
  requirePermission("accounting.reverse"),
  validateBody(z.object({ reason: z.string().min(3) })),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const entry = await prisma.journalEntry.findUnique({ where: { id: req.params.id as string } });
    if (!entry || entry.companyId !== companyId) throw ApiError.notFound("Journal entry not found");
    if (entry.reversed) throw ApiError.badRequest("Journal entry already reversed");
    const reversalId = await reverseJournal(prisma as any, req.params.id as string, req.user!.id, req.body.reason);
    await writeAudit(prisma as any, {
      companyId,
      branchId: entry.branchId,
      userId: req.user!.id,
      action: AuditAction.REVERSE,
      entity: "JOURNAL_ENTRY",
      entityId: req.params.id as string,
      description: `Reversed journal ${entry.reference}: ${req.body.reason}`,
    });
    res.json({ reversalId });
  })
);

// ==================== TRIAL BALANCE ====================

router.get(
  "/trial-balance",
  requirePermission("report.financial"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const from = req.query.from as string ? new Date(req.query.from as string) : undefined;
    const to = req.query.to as string ? new Date(req.query.to as string) : undefined;
    const branchId = req.query.branchId as string | undefined;

    const accounts = await prisma.account.findMany({
      where: { companyId, isActive: true, ...(branchId ? { branchId } : {}) },
      orderBy: { code: "asc" },
    });

    const lines = await prisma.journalLine.groupBy({
      by: ["accountId"],
      where: {
        accountId: { in: accounts.map((a) => a.id) },
        journalEntry: { companyId, posted: true, reversed: false, entryDate: { gte: from, lte: to } },
        ...(branchId ? { branchId } : {}),
      },
      _sum: { debit: true, credit: true },
    });

    const lineMap = new Map(lines.map((l) => [l.accountId, { debit: d(l._sum.debit ?? 0), credit: d(l._sum.credit ?? 0) }]));

    const rows = accounts.map((a) => {
      const bal = lineMap.get(a.id) ?? { debit: d(0), credit: d(0) };
      const net = bal.debit.minus(bal.credit);
      return {
        id: a.id,
        code: a.code,
        name: a.name,
        type: a.type,
        debit: bal.debit.toNumber(),
        credit: bal.credit.toNumber(),
        balance: net.toNumber(),
        isDebit: net.isPositive(),
      };
    });

    const totalDebit = sum(rows.filter((r) => r.isDebit).map((r) => r.debit));
    const totalCredit = sum(rows.filter((r) => !r.isDebit).map((r) => Math.abs(r.credit)));

    res.json({
      items: rows.filter((r) => r.debit !== 0 || r.credit !== 0),
      totalDebit: totalDebit.toNumber(),
      totalCredit: totalCredit.toNumber(),
      isBalanced: totalDebit.equals(totalCredit),
      period: { from, to },
    });
  })
);

// ==================== FINANCIAL REPORTS ====================

router.get(
  "/profit-and-loss",
  requirePermission("report.financial"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const from = req.query.from as string ? new Date(req.query.from as string) : new Date(new Date().getFullYear(), 0, 1);
    const to = req.query.to as string ? new Date(new Date(req.query.to as string).getTime() + 86400000 - 1) : new Date();
    const branchId = req.query.branchId as string | undefined;

    const revenueAccounts = await prisma.account.findMany({
      where: { companyId, type: { in: ["REVENUE", "CONTRA_REVENUE"] }, isActive: true },
      orderBy: { code: "asc" },
    });
    const expenseAccounts = await prisma.account.findMany({
      where: { companyId, type: { in: ["EXPENSE", "CONTRA_ASSET"] }, isActive: true },
      orderBy: { code: "asc" },
    });

    const allIds = [...revenueAccounts, ...expenseAccounts].map((a) => a.id);
    const lines = await prisma.journalLine.groupBy({
      by: ["accountId"],
      where: {
        accountId: { in: allIds },
        journalEntry: { companyId, posted: true, reversed: false, entryDate: { gte: from, lte: to } },
        ...(branchId ? { branchId } : {}),
      },
      _sum: { debit: true, credit: true },
    });
    const lineMap = new Map(lines.map((l) => [l.accountId, { debit: d(l._sum.debit ?? 0), credit: d(l._sum.credit ?? 0) }]));

    const formatSection = (accounts: typeof revenueAccounts) =>
      accounts.map((a) => {
        const bal = lineMap.get(a.id) ?? { debit: d(0), credit: d(0) };
        const net = a.type === "REVENUE" ? bal.credit.minus(bal.debit) : bal.debit.minus(bal.credit);
        return { id: a.id, code: a.code, name: a.name, amount: net.toNumber() };
      }).filter((r) => r.amount !== 0);

    const revenue = formatSection(revenueAccounts);
    const expenses = formatSection(expenseAccounts);
    const totalRevenue = sum(revenue.map((r) => r.amount));
    const totalExpenses = sum(expenses.map((r) => Math.abs(r.amount)));
    const netIncome = totalRevenue.minus(totalExpenses);

    res.json({ revenue, expenses, totalRevenue: totalRevenue.toNumber(), totalExpenses: totalExpenses.toNumber(), netIncome: netIncome.toNumber(), period: { from, to } });
  })
);

router.get(
  "/balance-sheet",
  requirePermission("report.financial"),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const asOf = req.query.asOf as string ? new Date(req.query.asOf as string) : new Date();
    const to = new Date(asOf.getTime() + 86400000 - 1);
    const branchId = req.query.branchId as string | undefined;

    const accounts = await prisma.account.findMany({
      where: { companyId, type: { in: ["ASSET", "LIABILITY", "EQUITY"] }, isActive: true },
      orderBy: { code: "asc" },
    });

    const lines = await prisma.journalLine.groupBy({
      by: ["accountId"],
      where: {
        accountId: { in: accounts.map((a) => a.id) },
        journalEntry: { companyId, posted: true, reversed: false, entryDate: { lte: to } },
        ...(branchId ? { branchId } : {}),
      },
      _sum: { debit: true, credit: true },
    });
    const lineMap = new Map(lines.map((l) => [l.accountId, { debit: d(l._sum.debit ?? 0), credit: d(l._sum.credit ?? 0) }]));

    const formatType = (accs: typeof accounts) =>
      accs.map((a) => {
        const bal = lineMap.get(a.id) ?? { debit: d(0), credit: d(0) };
        const net = a.type === "ASSET" || a.type === "CONTRA_ASSET"
          ? bal.debit.minus(bal.credit)
          : bal.credit.minus(bal.debit);
        return { id: a.id, code: a.code, name: a.name, type: a.type, amount: net.plus(d(a.openingBalance)).toNumber() };
      }).filter((r) => r.amount !== 0);

    const assets = formatType(accounts.filter((a) => a.type === "ASSET"));
    const liabilities = formatType(accounts.filter((a) => a.type === "LIABILITY"));
    const equity = formatType(accounts.filter((a) => a.type === "EQUITY"));

    const totalAssets = sum(assets.map((a) => a.amount));
    const totalLiabilities = sum(liabilities.map((a) => Math.abs(a.amount)));
    const totalEquity = sum(equity.map((a) => Math.abs(a.amount)));

    res.json({ assets, liabilities, equity, totalAssets: totalAssets.toNumber(), totalLiabilities: totalLiabilities.toNumber(), totalEquity: totalEquity.toNumber(), asOf });
  })
);

// ==================== FINANCIAL PERIODS ====================

router.get(
  "/periods",
  requirePermission("accounting.view"),
  asyncHandler(async (req, res) => {
    const periods = await prisma.financialPeriod.findMany({
      where: { companyId: req.user!.companyId },
      orderBy: { startDate: "desc" },
    });
    res.json({ items: periods });
  })
);

router.post(
  "/periods",
  requirePermission("account.inventory"),
  validateBody(z.object({
    name: z.string().min(1),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })),
  asyncHandler(async (req, res) => {
    const existing = await prisma.financialPeriod.findUnique({
      where: { companyId_name: { companyId: req.user!.companyId, name: req.body.name } },
    });
    if (existing) throw ApiError.badRequest("Period name already exists");
    const period = await prisma.financialPeriod.create({
      data: { companyId: req.user!.companyId, ...req.body },
    });
    res.status(201).json(period);
  })
);

router.post(
  "/periods/:id/close",
  requirePermission("account.inventory"),
  asyncHandler(async (req, res) => {
    const period = await prisma.financialPeriod.findUnique({ where: { id: req.params.id as string } });
    if (!period || period.companyId !== req.user!.companyId) throw ApiError.notFound("Period not found");
    if (period.status !== "OPEN") throw ApiError.badRequest("Period is not open");
    const updated = await prisma.financialPeriod.update({
      where: { id: period.id },
      data: { status: "CLOSED", closedById: req.user!.id, closedAt: new Date() },
    });
    res.json(updated);
  })
);

export default router;