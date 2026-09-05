import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { d, mul, div, add } from "../utils/money";
import { ApiError } from "../utils/ApiError";

export interface TaxCalculationInput {
  companyId: string;
  amount: Prisma.Decimal | string | number;
  taxRateId?: string | null;
  taxRatePercent?: number | null;
  inclusive?: boolean; // is the given amount VAT-inclusive?
  exchangeRate?: Prisma.Decimal | string | number;
}

export interface TaxCalculationResult {
  netAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  total: Prisma.Decimal;
  ratePercent: Prisma.Decimal;
}

// Compute VAT per configured tax rate
export async function calculateTax(input: TaxCalculationInput): Promise<TaxCalculationResult> {
  const amount = d(input.amount);
  let ratePercent = d(input.taxRatePercent ?? 0);

  if (input.taxRateId) {
    const rate = await prisma.taxRate.findUnique({ where: { id: input.taxRateId } });
    if (!rate) throw ApiError.notFound("Tax rate not found");
    if (!rate.isActive) throw ApiError.badRequest("Tax rate is inactive");
    ratePercent = d(rate.rate);
  }

  const rate = div(ratePercent, 100);
  if (input.inclusive) {
    const net = div(amount, add(1, rate));
    const tax = amount.minus(net);
    return { netAmount: net, taxAmount: tax, total: amount, ratePercent };
  }
  const tax = mul(amount, rate);
  return { netAmount: amount, taxAmount: tax, total: add(amount, tax), ratePercent };
}

// Get the default VAT mode for a company (INCLUSIVE / EXCLUSIVE)
export async function getDefaultVatMode(companyId: string): Promise<"INCLUSIVE" | "EXCLUSIVE"> {
  const setting = await prisma.appSetting.findUnique({
    where: { companyId_group_key: { companyId, group: "ACCOUNTING", key: "default_vat_mode" } },
  });
  return setting?.value === "INCLUSIVE" ? "INCLUSIVE" : "EXCLUSIVE";
}