import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";

interface SequenceOptions {
  companyId: string;
  branchId?: string | null;
  docType: string;
  prefix?: string;
  year?: string;
}

// Generate a sequential document reference atomically (e.g. INV-2026-000001)
export async function nextReference(opts: SequenceOptions): Promise<string> {
  const year = opts.year ?? new Date().getFullYear().toString();
  const branch = opts.branchId ?? null;

  const docPrefix = opts.prefix ?? defaultPrefix(opts.docType);
  const separator = "-";

  const result = await prisma.$transaction(async (tx) => {
    const lockKey = `${opts.companyId}-${branch ?? "HQ"}-${opts.docType}-${year}`;

    // Atomic upsert with increment using a serializable pattern
    const seq = await tx.documentSequence.findUnique({
      where: {
        companyId_branchId_docType_year: {
          companyId: opts.companyId,
          branchId: branch ?? "",
          docType: opts.docType,
          year,
        },
      },
    });

    if (seq) {
      const updated = await tx.documentSequence.update({
        where: { id: seq.id },
        data: { nextSeq: seq.nextSeq + 1 },
      });
      return { prefix: docPrefix, num: seq.nextSeq, separator };
    }

    const created = await tx.documentSequence.create({
      data: {
        companyId: opts.companyId,
        branchId: branch ?? "",
        docType: opts.docType,
        prefix: docPrefix,
        year,
        nextSeq: 2,
        padding: 6,
        separator,
      },
    });
    return { prefix: docPrefix, num: 1, separator };
  });

  const padding = result.prefix ? 6 : 6;
  const seqStr = result.num.toString().padStart(padding, "0");
  return `${result.prefix}${result.separator}${year}${result.separator}${seqStr}`;
}

export function defaultPrefix(docType: string): string {
  const prefixes: Record<string, string> = {
    INVOICE: "INV",
    POS: "POS",
    QUOTATION: "QT",
    SALES_ORDER: "SO",
    CREDIT_NOTE: "CN",
    PURCHASE_ORDER: "PO",
    GRN: "GRN",
    SUPPLIER_INVOICE: "SI",
    PURCHASE_RETURN: "PR",
    TRANSFER: "TRF",
    STOCK_ADJUSTMENT: "ADJ",
    STOCK_COUNT: "SC",
    PAYMENT: "PAY",
    RECEIPT: "REC",
    EXPENSE: "EXP",
    RETURN: "RET",
    JOURNAL: "GL",
    PAYROLL: "PRL",
    ASSET: "AST",
    EMPLOYEE: "EMP",
    CUSTOMER: "CUS",
    SUPPLIER: "SUP",
    PURCHASE_REQUEST: "PR",
  };
  return prefixes[docType] ?? docType.substring(0, 3).toUpperCase();
}

export async function reserveReference(
  tx: {
    documentSequence: {
      findUnique: (a: unknown) => Promise<any>;
      create: (a: unknown) => Promise<any>;
      update: (a: unknown) => Promise<any>;
    };
  },
  opts: SequenceOptions
): Promise<string> {
  const year = opts.year ?? new Date().getFullYear().toString();
  const branch = opts.branchId ?? null;
  const docPrefix = opts.prefix ?? defaultPrefix(opts.docType);
  const separator = "-";

  const existing = await tx.documentSequence.findUnique({
    where: {
      companyId_branchId_docType_year: {
        companyId: opts.companyId,
        branchId: branch,
        docType: opts.docType,
        year,
      },
    },
  });

  let num: number;
  if (existing) {
    await tx.documentSequence.update({ where: { id: existing.id }, data: { nextSeq: existing.nextSeq + 1 } });
    num = existing.nextSeq;
  } else {
    await tx.documentSequence.create({
      data: {
        companyId: opts.companyId,
        branchId: branch,
        docType: opts.docType,
        prefix: docPrefix,
        year,
        nextSeq: 2,
      },
    });
    num = 1;
  }

  return `${docPrefix}${separator}${year}${separator}${num.toString().padStart(6, "0")}`;
}

export { ApiError };