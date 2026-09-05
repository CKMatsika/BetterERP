import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { d, sum, isZero } from "../utils/money";
import { nextReference } from "./sequence.service";

type Tx = Prisma.TransactionClient;

export interface JournalLineInput {
  accountId: string;
  branchId?: string | null;
  departmentId?: string | null;
  costCentreId?: string | null;
  profitCentreId?: string | null;
  debit?: Prisma.Decimal | string | number;
  credit?: Prisma.Decimal | string | number;
  description?: string;
}

export interface JournalInput {
  companyId: string;
  branchId?: string | null;
  reference?: string;
  description: string;
  entryType: string;
  sourceType?: string;
  sourceId?: string;
  entryDate?: Date;
  currency?: string;
  exchangeRate?: Prisma.Decimal | string | number;
  userId?: string | null;
  lines: JournalLineInput[];
  skipReference?: boolean;
}

// Core posting engine - guarantees balanced double-entry journals
export async function postJournal(
  tx: Tx,
  input: JournalInput
): Promise<string> {
  const debits = input.lines.map((l) => d(l.debit ?? 0));
  const credits = input.lines.map((l) => d(l.credit ?? 0));

  if (sum(debits).comparedTo(sum(credits)) !== 0) {
    throw ApiError.badRequest("Journal entry does not balance (debits != credits)");
  }
  if (input.lines.length === 0) {
    throw ApiError.badRequest("Journal entry must have at least one line");
  }

  const reference = input.skipReference
    ? input.reference
    : input.reference ?? (await nextReference({ companyId: input.companyId, branchId: input.branchId ?? null, docType: "JOURNAL" }));

  const entry = await tx.journalEntry.create({
    data: {
      companyId: input.companyId,
      branchId: input.branchId ?? null,
      reference: reference ?? "",
      description: input.description,
      entryType: input.entryType,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      entryDate: input.entryDate ?? new Date(),
      currency: input.currency ?? "USD",
      exchangeRate: d(input.exchangeRate ?? 1),
      posted: true,
      postedAt: new Date(),
      createdById: input.userId ?? null,
      lines: {
        create: input.lines.map((l) => ({
          accountId: l.accountId,
          branchId: l.branchId ?? input.branchId ?? null,
          departmentId: l.departmentId,
          costCentreId: l.costCentreId,
          profitCentreId: l.profitCentreId,
          debit: d(l.debit ?? 0),
          credit: d(l.credit ?? 0),
          description: l.description,
        })),
      },
    },
  });

  return entry.id;
}

// Reverse an existing journal by posting negated lines (balanced reversal)
export async function reverseJournal(
  tx: Tx,
  journalId: string,
  userId: string,
  reason?: string
): Promise<string> {
  const journal = await tx.journalEntry.findUnique({
    where: { id: journalId },
    include: { lines: true },
  });
  if (!journal) throw ApiError.notFound("Journal entry not found");
  if (journal.reversed) throw ApiError.badRequest("Journal entry already reversed");

  const lines = journal.lines.map((l) => ({
    accountId: l.accountId,
    branchId: l.branchId,
    departmentId: l.departmentId,
    costCentreId: l.costCentreId,
    profitCentreId: l.profitCentreId,
    debit: l.credit.isZero() ? undefined : l.credit as unknown as number,
    credit: l.debit.isZero() ? undefined : l.debit as unknown as number,
  }));

  const description = `Reversal of ${journal.reference}${reason ? ` - ${reason}` : ""}`;
  const reversalId = await postJournal(tx, {
    companyId: journal.companyId,
    branchId: journal.branchId,
    description,
    entryType: journal.entryType,
    sourceType: "REVERSAL",
    sourceId: journal.id,
    userId,
    entryDate: new Date(),
    currency: journal.currency,
    exchangeRate: journal.exchangeRate,
    lines,
  });

  await tx.journalEntry.update({
    where: { id: journalId },
    data: { reversed: true, reversedById: userId, reversedAt: new Date(), reversalOfId: reversalId },
  });

  return reversalId;
}

// Account balance computation within a period/branch
export interface BalanceFilter {
  companyId: string;
  branchId?: string | null;
  accountId?: string;
  from?: Date;
  to?: Date;
  includeAllBranches?: boolean;
}

export async function getAccountBalance(f: BalanceFilter): Promise<Prisma.Decimal> {
  const where: Prisma.JournalLineWhereInput = {
    journalEntry: {
      companyId: f.companyId,
      posted: true,
      entryDate: {
        gte: f.from,
        lte: f.to,
      },
      reversed: false,
    },
    accountId: f.accountId,
  };
  if (!f.includeAllBranches) where.branchId = f.branchId ?? null;

  const aggr = await prisma.journalLine.aggregate({
    where,
    _sum: { debit: true, credit: true },
  });
  return d(aggr._sum.debit ?? 0).minus(d(aggr._sum.credit ?? 0));
}

export function netBalance(debits: Prisma.Decimal, credits: Prisma.Decimal): Prisma.Decimal {
  return d(debits).minus(d(credits));
}

export function isBalanced(debits: Prisma.Decimal[], credits: Prisma.Decimal[]): boolean {
  return sum(debits).comparedTo(sum(credits)) === 0;
}

// Ensure two journal lines are internally balanced (helper for quick validation)
export function assertBalanced(lines: JournalLineInput[]) {
  if (!isBalanced(lines.map((l) => d(l.debit ?? 0)), lines.map((l) => d(l.credit ?? 0)))) {
    throw ApiError.badRequest("Journal entry is not balanced");
  }
}

export async function findAccountByCode(
  tx: Tx,
  companyId: string,
  branchId: string | null,
  code: string
): Promise<{ id: string } | null> {
  return tx.account.findFirst({
    where: { companyId, branchId, code },
    select: { id: true },
  });
}

export async function findOrCreateAccount(
  tx: Tx,
  companyId: string,
  branchId: string | null,
  code: string,
  name: string
): Promise<{ id: string }> {
  const existing = await findAccountByCode(tx, companyId, branchId, code);
  if (existing) return existing;
  return tx.account.create({
    data: {
      companyId,
      branchId,
      code,
      name,
      type: "ASSET",
      category: "OTHER",
      normalBalance: "DEBIT",
    },
    select: { id: true },
  });
}

export { Prisma };