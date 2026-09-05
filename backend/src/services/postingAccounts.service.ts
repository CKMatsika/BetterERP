import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";

type Tx = Prisma.TransactionClient;

// Resolve an account for a branch, falling back to company-level account.
// Cash/Bank/Payable/Receivable accounts are branch-specific where they exist.
export async function resolveAccount(
  tx: Tx,
  companyId: string,
  code: string,
  branchId: string | null,
  preferBranchSpecific = true
): Promise<string> {
  if (preferBranchSpecific && branchId) {
    const branchAcc = await tx.account.findFirst({ where: { companyId, branchId, code } });
    if (branchAcc) return branchAcc.id;
  }
  const companyAcc = await tx.account.findFirst({ where: { companyId, branchId: null, code } });
  if (companyAcc) return companyAcc.id;

  throw ApiError.badRequest(`Required account not found: ${code}. Configure the chart of accounts.`);
}

export async function resolveAccountByName(
  tx: Tx,
  companyId: string,
  name: string,
  branchId: string | null
): Promise<string> {
  const acc = await tx.account.findFirst({
    where: { companyId, OR: [{ branchId: null }, { branchId }], name },
  });
  if (acc) return acc.id;
  throw ApiError.badRequest(`Required account not found: ${name}`);
}

export async function getAccountOrNull(
  tx: Tx,
  companyId: string,
  code: string,
  branchId: string | null
): Promise<string | null> {
  try {
    return await resolveAccount(tx, companyId, code, branchId);
  } catch {
    return null;
  }
}

export interface PostingAccounts {
  cashAccountId: string;
  bankAccountId: string;
  salesRevenueId: string;
  wholesaleRevenueId: string;
  retailRevenueId: string;
  vatOutputId: string;
  costOfSalesId: string;
  inventoryId: string;
  inventoryInTransitId: string;
  goodsReceivedNotInvoicedId: string;
  arTradeId: string;
  apTradeId: string;
  salesReturnsId: string;
  salesDiscountsId: string;
  stockWriteoffId: string;
  otherExpenses: string;
}

export async function getPostingAccounts(
  tx: Tx,
  companyId: string,
  branchId: string | null
): Promise<PostingAccounts> {
  const [cashAccountId, bankAccountId, salesRevenueId, wholesaleRevenueId, retailRevenueId, vatOutputId, costOfSalesId, inventoryId, inventoryInTransitId, goodsReceivedNotInvoicedId, arTradeId, apTradeId, salesReturnsId, salesDiscountsId, stockWriteoffId, otherExpenses] = await Promise.all([
    resolveAccount(tx, companyId, "1100", branchId, true).catch(() => resolveAccount(tx, companyId, "1100", null, false)),
    resolveAccount(tx, companyId, "1201", branchId, true).catch(() => resolveAccount(tx, companyId, "1201", null, false)),
    resolveAccount(tx, companyId, "4100", null, false),
    resolveAccount(tx, companyId, "4200", null, false),
    resolveAccount(tx, companyId, "4100", null, false),
    resolveAccount(tx, companyId, "2201", null, false),
    resolveAccount(tx, companyId, "5100", null, false),
    resolveAccount(tx, companyId, "1401", null, false),
    resolveAccount(tx, companyId, "1402", null, false),
    resolveAccount(tx, companyId, "2102", null, false),
    resolveAccount(tx, companyId, "1301", null, false),
    resolveAccount(tx, companyId, "2101", null, false),
    resolveAccount(tx, companyId, "4310", null, false),
    resolveAccount(tx, companyId, "4320", null, false),
    resolveAccount(tx, companyId, "5200", null, false),
    resolveAccount(tx, companyId, "6800", null, false),
  ]);

  return {
    cashAccountId,
    bankAccountId,
    salesRevenueId,
    wholesaleRevenueId,
    retailRevenueId,
    vatOutputId,
    costOfSalesId,
    inventoryId,
    inventoryInTransitId,
    goodsReceivedNotInvoicedId,
    arTradeId,
    apTradeId,
    salesReturnsId,
    salesDiscountsId,
    stockWriteoffId,
    otherExpenses,
  };
}

export const ACCOUNT_CODES = {
  cash: "1100",
  bank: "1201",
  arTrade: "1301",
  inventory: "1401",
  inventoryInTransit: "1402",
  vatInput: "1601",
  salesRetail: "4100",
  salesWholesale: "4200",
  otherRevenue: "4300",
  salesReturns: "4310",
  salesDiscounts: "4320",
  costOfSales: "5100",
  stockWriteoff: "5200",
  salaries: "6100",
  nssa: "6110",
  pension: "6120",
  rent: "6200",
  utilities: "6300",
  transport: "6400",
  repairs: "6500",
  marketing: "6600",
  bankCharges: "6700",
  otherExpenses: "6800",
  depreciation: "6801",
  vatOutput: "2201",
  payePayable: "2202",
  nssaPayable: "2203",
  apTrade: "2101",
  staffAdvances: "1602",
  accruedExpenses: "2302",
  currentYearEarnings: "3300",
  ownerCapital: "3100",
  accumulatedDepreciation: "1510",
} as const;