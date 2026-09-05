import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { asyncHandler, parsePagination } from "../utils/handlers";
import { validateBody } from "../middleware/validate";
import { requirePermission, effectiveBranchId, branchMatchesUser } from "../middleware/auth";
import { postJournal } from "../services/accounting.service";
import { getPostingAccounts } from "../services/postingAccounts.service";
import { writeAudit } from "../services/audit.service";
import { AuditAction } from "@prisma/client";
import { d, sub, add } from "../utils/money";

const router = Router();

// ==================== BANK ACCOUNTS ====================

const bankAccountSchema = z.object({
  accountName: z.string().min(1),
  bankName: z.string().min(1),
  accountNumber: z.string().min(1),
  branchCode: z.string().optional().nullable(),
  swiftCode: z.string().optional().nullable(),
  currency: z.string().default("USD"),
  openingBalance: z.coerce.number().optional(),
  isDefault: z.boolean().optional(),
  branchId: z.string().optional().nullable(),
  accountId: z.string().optional().nullable(),
});

router.get(
  "/accounts",
  requirePermission("bank.view"),
  asyncHandler(async (req, res) => {
    const where: Prisma.BankAccountWhereInput = { companyId: req.user!.companyId };
    const branchId = effectiveBranchId(req);
    if (req.query.branchId as string) where.branchId = req.query.branchId as string;
    else if (branchId && !req.user!.canViewAllBranches) where.branchId = branchId;
    if (req.query.search as string) {
      where.OR = [
        { accountName: { contains: req.query.search as string, mode: "insensitive" } },
        { bankName: { contains: req.query.search as string, mode: "insensitive" } },
        { accountNumber: { contains: req.query.search as string, mode: "insensitive" } },
      ];
    }
    const accounts = await prisma.bankAccount.findMany({
      where,
      include: { account: { select: { id: true, code: true, name: true } } },
      orderBy: { accountName: "asc" },
    });
    res.json({ items: accounts });
  })
);

router.get(
  "/accounts/:id",
  requirePermission("bank.view"),
  asyncHandler(async (req, res) => {
    const account = await prisma.bankAccount.findUnique({
      where: { id: req.params.id as string },
      include: { account: true },
    });
    if (!account || account.companyId !== req.user!.companyId) throw ApiError.notFound("Bank account not found");
    if (!branchMatchesUser(req, account.branchId)) throw ApiError.forbidden("You do not have access to this bank account");
    res.json(account);
  })
);

router.post(
  "/accounts",
  requirePermission("bank.edit"),
  validateBody(bankAccountSchema),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const bankAcc = await prisma.$transaction(async (tx) => {
      const acc = await tx.bankAccount.create({
        data: { companyId, ...req.body },
      });
      await writeAudit(tx as any, {
        companyId,
        branchId: req.body.branchId ?? null,
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entity: "BANK_ACCOUNT",
        entityId: acc.id,
        afterJson: { accountName: acc.accountName, bankName: acc.bankName },
      });
      return acc;
    });
    res.status(201).json(bankAcc);
  })
);

router.put(
  "/accounts/:id",
  requirePermission("bank.edit"),
  validateBody(bankAccountSchema.partial()),
  asyncHandler(async (req, res) => {
    const account = await prisma.bankAccount.findUnique({ where: { id: req.params.id as string } });
    if (!account || account.companyId !== req.user!.companyId) throw ApiError.notFound("Bank account not found");
    const updated = await prisma.bankAccount.update({ where: { id: account.id }, data: req.body });
    res.json(updated);
  })
);

// ==================== BANK TRANSACTIONS ====================

const transactionSchema = z.object({
  description: z.string().min(1),
  reference: z.string().optional().nullable(),
  withdrawal: z.coerce.number().min(0).optional(),
  deposit: z.coerce.number().min(0).optional(),
  transactionDate: z.coerce.date().optional(),
  sourceType: z.string().optional(),
  sourceId: z.string().optional(),
});

const importSchema = z.object({
  transactions: z.array(z.object({
    transactionDate: z.coerce.date(),
    description: z.string().min(1),
    reference: z.string().optional().nullable(),
    withdrawal: z.coerce.number().min(0).default(0),
    deposit: z.coerce.number().min(0).default(0),
  })).min(1),
});

router.get(
  "/accounts/:bankAccountId/transactions",
  requirePermission("bank.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const bankAccount = await prisma.bankAccount.findUnique({ where: { id: req.params.bankAccountId as string } });
    if (!bankAccount || bankAccount.companyId !== req.user!.companyId) throw ApiError.notFound("Bank account not found");
    if (!branchMatchesUser(req, bankAccount.branchId)) throw ApiError.forbidden("You do not have access to this bank account");
    const where: Prisma.BankTransactionWhereInput = { bankAccountId: bankAccount.id };
    if (req.query.from as string || req.query.to as string) {
      where.transactionDate = {
        gte: req.query.from as string ? new Date(req.query.from as string) : undefined,
        lte: req.query.to as string ? new Date(new Date(req.query.to as string).getTime() + 86400000 - 1) : undefined,
      };
    }
    if (req.query.reconciled as string !== undefined) where.reconciled = req.query.reconciled as string === "true";
    const [total, items] = await Promise.all([
      prisma.bankTransaction.count({ where }),
      prisma.bankTransaction.findMany({ where, orderBy: { transactionDate: "desc" }, skip, take: pageSize }),
    ]);
    res.json({ items, total, page, pageSize });
  })
);

router.post(
  "/accounts/:bankAccountId/deposits",
  requirePermission("bank.edit"),
  validateBody(transactionSchema),
  asyncHandler(async (req, res) => {
    const bankAccount = await prisma.bankAccount.findUnique({ where: { id: req.params.bankAccountId as string } });
    if (!bankAccount || bankAccount.companyId !== req.user!.companyId) throw ApiError.notFound("Bank account not found");
    if (!branchMatchesUser(req, bankAccount.branchId)) throw ApiError.forbidden("You do not have access to this bank account");
    const amount = d(req.body.deposit ?? 0);
    if (amount.isZero()) throw ApiError.badRequest("Deposit amount must be positive");

    return prisma.$transaction(async (tx) => {
      const lastTx = await tx.bankTransaction.findFirst({
        where: { bankAccountId: bankAccount.id },
        orderBy: { createdAt: "desc" },
      });
      const balance = d(lastTx?.balance ?? bankAccount.openingBalance).plus(amount);

      const txRecord = await tx.bankTransaction.create({
        data: {
          bankAccountId: bankAccount.id,
          description: req.body.description,
          reference: req.body.reference,
          deposit: amount,
          withdrawal: 0,
          balance,
          transactionDate: req.body.transactionDate ?? new Date(),
          sourceType: req.body.sourceType,
          sourceId: req.body.sourceId,
        },
      });

      // GL entry: Debit bank, Credit other account
      const postingAccounts = await getPostingAccounts(tx as any, req.user!.companyId, bankAccount.branchId);
      await postJournal(tx as any, {
        companyId: req.user!.companyId,
        branchId: bankAccount.branchId,
        description: `Bank deposit: ${req.body.description}`,
        entryType: "DEPOSIT",
        userId: req.user!.id,
        lines: [
          { accountId: postingAccounts.bankAccountId, debit: amount, description: req.body.description },
          { accountId: postingAccounts.cashAccountId, credit: amount, description: req.body.description },
        ],
      });
      return txRecord;
    }).then((rec) => res.status(201).json(rec));
  })
);

router.post(
  "/accounts/:bankAccountId/withdrawals",
  requirePermission("bank.edit"),
  validateBody(transactionSchema),
  asyncHandler(async (req, res) => {
    const bankAccount = await prisma.bankAccount.findUnique({ where: { id: req.params.bankAccountId as string } });
    if (!bankAccount || bankAccount.companyId !== req.user!.companyId) throw ApiError.notFound("Bank account not found");
    if (!branchMatchesUser(req, bankAccount.branchId)) throw ApiError.forbidden("You do not have access to this bank account");
    const amount = d(req.body.withdrawal ?? 0);
    if (amount.isZero()) throw ApiError.badRequest("Withdrawal amount must be positive");

    return prisma.$transaction(async (tx) => {
      const lastTx = await tx.bankTransaction.findFirst({
        where: { bankAccountId: bankAccount.id },
        orderBy: { createdAt: "desc" },
      });
      const balance = d(lastTx?.balance ?? bankAccount.openingBalance).minus(amount);

      const txRecord = await tx.bankTransaction.create({
        data: {
          bankAccountId: bankAccount.id,
          description: req.body.description,
          reference: req.body.reference,
          withdrawal: amount,
          deposit: 0,
          balance,
          transactionDate: req.body.transactionDate ?? new Date(),
          sourceType: req.body.sourceType,
          sourceId: req.body.sourceId,
        },
      });

      const postingAccounts = await getPostingAccounts(tx as any, req.user!.companyId, bankAccount.branchId);
      await postJournal(tx as any, {
        companyId: req.user!.companyId,
        branchId: bankAccount.branchId,
        description: `Bank withdrawal: ${req.body.description}`,
        entryType: "WITHDRAWAL",
        userId: req.user!.id,
        lines: [
          { accountId: postingAccounts.cashAccountId, debit: amount, description: req.body.description },
          { accountId: postingAccounts.bankAccountId, credit: amount, description: req.body.description },
        ],
      });
      return { id: txRecord.id };
    }).then((rec) => res.status(201).json(rec));
  })
);

// Import bank statement rows without marking them reconciled. Reconciliation remains an explicit review step.
router.post(
  "/accounts/:bankAccountId/import",
  requirePermission("bank.edit"),
  validateBody(importSchema),
  asyncHandler(async (req, res) => {
    const bankAccount = await prisma.bankAccount.findUnique({ where: { id: req.params.bankAccountId as string } });
    if (!bankAccount || bankAccount.companyId !== req.user!.companyId) throw ApiError.notFound("Bank account not found");
    if (!branchMatchesUser(req, bankAccount.branchId)) throw ApiError.forbidden("You do not have access to this bank account");
    const validRows = req.body.transactions.filter((row: { deposit: number; withdrawal: number }) => (row.deposit > 0) !== (row.withdrawal > 0));
    if (validRows.length !== req.body.transactions.length) throw ApiError.badRequest("Each statement row must contain either a deposit or a withdrawal");

    const imported = await prisma.$transaction(async (tx) => {
      const lastTx = await tx.bankTransaction.findFirst({ where: { bankAccountId: bankAccount.id }, orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }] });
      let balance = d(lastTx?.balance ?? bankAccount.openingBalance);
      const created = [];
      let skipped = 0;
      for (const row of req.body.transactions) {
        if (row.reference) {
          const existing = await tx.bankTransaction.findFirst({ where: { bankAccountId: bankAccount.id, reference: row.reference } });
          if (existing) { skipped += 1; continue; }
        }
        balance = balance.plus(d(row.deposit)).minus(d(row.withdrawal));
        created.push(await tx.bankTransaction.create({
          data: { bankAccountId: bankAccount.id, transactionDate: row.transactionDate, description: row.description, reference: row.reference, deposit: d(row.deposit), withdrawal: d(row.withdrawal), balance, sourceType: "BANK_STATEMENT", reconciled: false },
        }));
      }
      await writeAudit(tx as any, { companyId: req.user!.companyId, branchId: bankAccount.branchId, userId: req.user!.id, action: AuditAction.CREATE, entity: "BANK_STATEMENT_IMPORT", afterJson: { imported: created.length, skipped } });
      return { imported: created.length, skipped };
    });
    res.status(201).json(imported);
  })
);

// ==================== RECONCILIATION ====================

const reconcileSchema = z.object({
  statementDate: z.coerce.date(),
  statementBalance: z.coerce.number(),
  reconciledTxIds: z.array(z.string()).min(1),
});

router.get(
  "/accounts/:bankAccountId/reconciliations",
  requirePermission("bank.view"),
  asyncHandler(async (req, res) => {
    const items = await prisma.bankReconciliation.findMany({
      where: { bankAccountId: req.params.bankAccountId as string },
      orderBy: { statementDate: "desc" },
    });
    res.json({ items });
  })
);

router.get(
  "/accounts/:bankAccountId/reconciliation-status",
  requirePermission("bank.view"),
  asyncHandler(async (req, res) => {
    const bankAccount = await prisma.bankAccount.findUnique({ where: { id: req.params.bankAccountId as string } });
    if (!bankAccount || bankAccount.companyId !== req.user!.companyId) throw ApiError.notFound("Bank account not found");
    if (!branchMatchesUser(req, bankAccount.branchId)) throw ApiError.forbidden("You do not have access to this bank account");
    const lastRecon = await prisma.bankReconciliation.findFirst({
      where: { bankAccountId: bankAccount.id, status: "COMPLETED" },
      orderBy: { statementDate: "desc" },
    });
    const lastDate = lastRecon?.statementDate;
    const unreconciled = await prisma.bankTransaction.findMany({
      where: { bankAccountId: bankAccount.id, reconciled: false, ...(lastDate ? { transactionDate: { gt: lastDate } } : {}) },
    });
    const bookBalance = unreconciled.reduce(
      (acc, tx) => acc.plus(d(tx.deposit)).minus(d(tx.withdrawal)),
      d(lastRecon?.statementBalance ?? bankAccount.openingBalance)
    );
    res.json({
      lastReconciliation: lastRecon,
      unreconciledCount: unreconciled.length,
      bookBalance: bookBalance.toNumber(),
      unreconciledTransactions: unreconciled,
    });
  })
);

router.post(
  "/accounts/:bankAccountId/reconcile",
  requirePermission("bank.reconcile"),
  validateBody(reconcileSchema),
  asyncHandler(async (req, res) => {
    const bankAccount = await prisma.bankAccount.findUnique({ where: { id: req.params.bankAccountId as string } });
    if (!bankAccount || bankAccount.companyId !== req.user!.companyId) throw ApiError.notFound("Bank account not found");

    return prisma.$transaction(async (tx) => {
      // Mark transactions as reconciled
      await tx.bankTransaction.updateMany({
        where: { id: { in: req.body.reconciledTxIds }, bankAccountId: bankAccount.id },
        data: { reconciled: true },
      });

      // Calculate book balance
      const reconciledTx = await tx.bankTransaction.findMany({
        where: { id: { in: req.body.reconciledTxIds } },
      });
      const lastRecon = await tx.bankReconciliation.findFirst({
        where: { bankAccountId: bankAccount.id, status: "COMPLETED" },
        orderBy: { statementDate: "desc" },
      });
      const bookBalance = reconciledTx.reduce(
        (acc, tx) => acc.plus(d(tx.deposit)).minus(d(tx.withdrawal)),
        d(lastRecon?.statementBalance ?? bankAccount.openingBalance)
      );
      const stmtBalance = d(req.body.statementBalance);

      const recon = await tx.bankReconciliation.create({
        data: {
          bankAccountId: bankAccount.id,
          statementDate: req.body.statementDate,
          statementBalance: stmtBalance,
          bookBalance,
          difference: stmtBalance.minus(bookBalance),
          status: "COMPLETED",
          reconciledById: req.user!.id,
          completedAt: new Date(),
        },
      });

      await writeAudit(tx as any, {
        companyId: req.user!.companyId,
        branchId: bankAccount.branchId,
        userId: req.user!.id,
        action: AuditAction.POST,
        entity: "BANK_RECONCILIATION",
        entityId: recon.id,
        afterJson: { statementBalance: req.body.statementBalance, bookBalance: bookBalance.toNumber() },
      });
      return recon;
    }).then((r) => res.status(201).json(r));
  })
);

// ==================== BANK TRANSFERS ====================

router.post(
  "/transfers",
  requirePermission("bank.edit"),
  validateBody(z.object({
    fromBankAccountId: z.string(),
    toBankAccountId: z.string(),
    amount: z.coerce.number().positive(),
    description: z.string().min(1),
    reference: z.string().optional(),
    transferDate: z.coerce.date().optional(),
  })),
  asyncHandler(async (req, res) => {
    if (req.body.fromBankAccountId === req.body.toBankAccountId) throw ApiError.badRequest("Cannot transfer to the same account");
    const [fromAcc, toAcc] = await Promise.all([
      prisma.bankAccount.findUnique({ where: { id: req.body.fromBankAccountId } }),
      prisma.bankAccount.findUnique({ where: { id: req.body.toBankAccountId } }),
    ]);
    if (!fromAcc || !toAcc || fromAcc.companyId !== req.user!.companyId || toAcc.companyId !== req.user!.companyId) {
      throw ApiError.notFound("Bank account not found");
    }

    return prisma.$transaction(async (tx) => {
      const amount = d(req.body.amount);
      const date = req.body.transferDate ?? new Date();

      // Get last balances
      const [lastFrom, lastTo] = await Promise.all([
        tx.bankTransaction.findFirst({ where: { bankAccountId: fromAcc.id }, orderBy: { createdAt: "desc" } }),
        tx.bankTransaction.findFirst({ where: { bankAccountId: toAcc.id }, orderBy: { createdAt: "desc" } }),
      ]);
      const fromBal = d(lastFrom?.balance ?? fromAcc.openingBalance).minus(amount);
      const toBal = d(lastTo?.balance ?? toAcc.openingBalance).plus(amount);

      const [debit, credit] = await Promise.all([
        tx.bankTransaction.create({
          data: { bankAccountId: fromAcc.id, description: req.body.description, reference: req.body.reference, withdrawal: amount, balance: fromBal, transactionDate: date },
        }),
        tx.bankTransaction.create({
          data: { bankAccountId: toAcc.id, description: req.body.description, reference: req.body.reference, deposit: amount, balance: toBal, transactionDate: date },
        }),
      ]);

      // GL: Debit destination bank, Credit source bank
      const postingAccounts = await getPostingAccounts(tx as any, req.user!.companyId, fromAcc.branchId);
      const bankGlAccountId = postingAccounts.bankAccountId;

      await postJournal(tx as any, {
        companyId: req.user!.companyId,
        branchId: fromAcc.branchId,
        description: `Bank transfer: ${req.body.description}`,
        entryType: "TRANSFER",
        userId: req.user!.id,
        lines: [
          { accountId: toAcc.accountId ?? bankGlAccountId, debit: amount, description: `Transfer to ${toAcc.accountName}` },
          { accountId: fromAcc.accountId ?? bankGlAccountId, credit: amount, description: `Transfer from ${fromAcc.accountName}` },
        ],
      });

      return { debit, credit };
    }).then((rec) => res.status(201).json(rec));
  })
);

export default router;