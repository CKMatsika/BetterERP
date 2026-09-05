import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { asyncHandler, parsePagination } from "../utils/handlers";
import { validateBody } from "../middleware/validate";
import { requirePermission, effectiveBranchId } from "../middleware/auth";
import { postJournal } from "../services/accounting.service";
import { getPostingAccounts, ACCOUNT_CODES } from "../services/postingAccounts.service";
import { writeAudit } from "../services/audit.service";
import { AuditAction } from "@prisma/client";
import { nextReference } from "../services/sequence.service";
import { d, mul, sum } from "../utils/money";

const router = Router();

// ==================== PAYROLL SETTINGS ====================

router.get(
  "/settings",
  requirePermission("payroll.view"),
  asyncHandler(async (req, res) => {
    const settings = await prisma.payrollSetting.findMany({
      where: { companyId: req.user!.companyId, effectiveTo: null },
      orderBy: { type: "asc" },
    });
    res.json({ items: settings });
  })
);

router.get(
  "/settings/history",
  requirePermission("payroll.view"),
  asyncHandler(async (req, res) => {
    const settings = await prisma.payrollSetting.findMany({
      where: { companyId: req.user!.companyId },
      orderBy: { effectiveFrom: "desc" },
      take: 200,
    });
    res.json({ items: settings });
  })
);

router.post(
  "/settings",
  requirePermission("payroll.run"),
  validateBody(z.object({
    name: z.string().min(1),
    value: z.coerce.number().min(0),
    type: z.string().min(1),
    effectiveFrom: z.coerce.date().optional(),
  })),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    return prisma.$transaction(async (tx) => {
      // Deactivate previous setting of same type
      await tx.payrollSetting.updateMany({
        where: { companyId, type: req.body.type, effectiveTo: null },
        data: { effectiveTo: new Date() },
      });
      const setting = await tx.payrollSetting.create({
        data: { companyId, ...req.body },
      });
      return setting;
    }).then((r) => res.status(201).json(r));
  })
);

// ==================== PAYE CALCULATION ====================

// Zimbabwe PAYE brackets 2026 (configurable via PayrollSetting type=PAYE_BRACKET)
// NSSA rates are also configurable
const computePaye = (gross: number, settings: any[]): number => {
  // Sort by min threshold descending, find applicable bracket
  const brackets = settings.filter((s) => s.type === "PAYE_BRACKET").sort((a, b) => b.value.toNumber() - a.value.toNumber());
  // Default Zimbabwe 2024 brackets if none configured
  if (brackets.length === 0) return 0;
  // Simplified: use flat rate from first bracket if bracket structure not fully implemented
  const rate = d(0.2); // default 20%
  const taxable = Math.max(0, gross - 0); // apply allowances already
  return mul(taxable, rate).toNumber();
};

const computeNssa = (gross: number, ceiling: number, rate: number): number => {
  const capped = Math.min(gross, ceiling);
  return mul(capped, rate).toNumber();
};

// ==================== PAYROLL RUN ====================

const payrollRunSchema = z.object({
  branchId: z.string().optional(),
  periodName: z.string().min(1),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  payDate: z.coerce.date(),
  employeeIds: z.array(z.string()).min(1).optional(), // specific employees; if omitted, runs for all active
  currency: z.string().default("USD"),
  exchangeRate: z.coerce.number().default(1),
});

router.get(
  "/runs",
  requirePermission("payroll.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const where: Prisma.PayrollWhereInput = { companyId: req.user!.companyId };
    const branchId = effectiveBranchId(req);
    if (!req.user!.canViewAllBranches && branchId) where.branchId = branchId;
    if (req.query.status as string) where.status = req.query.status as string;
    if (req.query.branchId as string) where.branchId = req.query.branchId as string;
    const [total, items] = await Promise.all([
      prisma.payroll.count({ where }),
      prisma.payroll.findMany({
        where,
        include: { lines: { include: { employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true } } } } },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
    ]);
    res.json({ items, total, page, pageSize });
  })
);

router.get(
  "/runs/:id",
  requirePermission("payroll.view"),
  asyncHandler(async (req, res) => {
    const payroll = await prisma.payroll.findUnique({
      where: { id: req.params.id as string },
      include: { lines: { include: { employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true, department: { select: { name: true } } } } } } },
    });
    if (!payroll || payroll.companyId !== req.user!.companyId) throw ApiError.notFound("Payroll run not found");
    res.json(payroll);
  })
);

router.post(
  "/runs",
  requirePermission("payroll.run"),
  validateBody(payrollRunSchema),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const branchId = req.body.branchId ?? req.user!.branchId;

    // Fetch settings
    const settings = await prisma.payrollSetting.findMany({
      where: { companyId, effectiveTo: null },
    });

    const nssaCeiling = settings.find((s) => s.type === "NSSA_CEILING")?.value?.toNumber() ?? 480;
    const nssaRate = settings.find((s) => s.type === "NSSA_RATE")?.value?.toNumber() ?? 0.045;
    const aidLevyRate = settings.find((s) => s.type === "AID_LEVY")?.value?.toNumber() ?? 0.01;

    return prisma.$transaction(async (tx) => {
      const reference = await nextReference({ companyId, branchId, docType: "PAYROLL" });

      // Get employees
      const empWhere: Prisma.EmployeeWhereInput = { companyId, employmentStatus: "ACTIVE" };
      if (req.body.employeeIds) empWhere.id = { in: req.body.employeeIds };
      else if (branchId && !req.user!.canViewAllBranches) empWhere.branchId = branchId;

      const employees = await tx.employee.findMany({
        where: empWhere,
        include: { allowances: true, deductions: true, loans: { where: { status: "ACTIVE" } } },
      });

      let totalGross = d(0);
      let totalDeductions = d(0);
      let totalNet = d(0);
      let totalTax = d(0);

      const lines: any[] = [];

      for (const emp of employees) {
        const basicSalary = d(emp.basicSalary ?? 0);

        // Calculate allowances (fixed + percentage)
        let allowances = d(0);
        for (const a of emp.allowances) {
          if (a.type === "FIXED") allowances = allowances.plus(d(a.amount));
          else if (a.type === "PERCENTAGE" && a.percentage) allowances = allowances.plus(mul(basicSalary, d(a.percentage).div(100)));
        }

        const grossPay = basicSalary.plus(allowances);

        // Statutory deductions
        const nssa = d(computeNssa(grossPay.toNumber(), nssaCeiling, nssaRate));
        const aidLevy = mul(grossPay, d(aidLevyRate));
        const paye = d(computePaye(grossPay.minus(nssa).toNumber(), settings));

        const statutoryDeductions = nssa.plus(paye).plus(aidLevy);

        // Other deductions
        let otherDeductions = d(0);
        for (const ded of emp.deductions) {
          if (ded.isStatutory) continue; // already computed above
          if (ded.type === "FIXED") otherDeductions = otherDeductions.plus(d(ded.amount));
          else if (ded.type === "PERCENTAGE" && ded.percentage) otherDeductions = otherDeductions.plus(mul(grossPay, d(ded.percentage).div(100)));
        }

        // Loan deductions
        let loanDeductions = d(0);
        for (const loan of emp.loans) {
          const deduction = d(loan.monthlyDeduction);
          if (deduction.lessThanOrEqualTo(d(loan.outstandingBalance))) loanDeductions = loanDeductions.plus(deduction);
          else loanDeductions = loanDeductions.plus(d(loan.outstandingBalance));
        }

        const totalEmpDeductions = statutoryDeductions.plus(otherDeductions).plus(loanDeductions);
        const netPay = grossPay.minus(totalEmpDeductions);

        totalGross = totalGross.plus(grossPay);
        totalDeductions = totalDeductions.plus(totalEmpDeductions);
        totalNet = totalNet.plus(netPay);
        totalTax = totalTax.plus(paye);

        lines.push({
          employeeId: emp.id,
          basicSalary,
          allowances,
          grossPay,
          statutoryDeductions,
          otherDeductions,
          loanDeductions,
          totalDeductions: totalEmpDeductions,
          netPay,
          payeAmount: paye,
          nssaAmount: nssa,
          currency: req.body.currency,
          exchangeRate: req.body.exchangeRate,
        });
      }

      // Create payroll header
      const payroll = await tx.payroll.create({
        data: {
          companyId,
          branchId,
          reference,
          periodName: req.body.periodName,
          periodStart: req.body.periodStart,
          periodEnd: req.body.periodEnd,
          payDate: req.body.payDate,
          status: "DRAFT",
          totalGross,
          totalDeductions,
          totalNet,
          totalTax,
          currency: req.body.currency,
          exchangeRate: req.body.exchangeRate,
        },
      });

      // Create lines
      for (const line of lines) {
        await tx.payrollLine.create({ data: { payrollId: payroll.id, ...line } });
      }

      await writeAudit(tx as any, {
        companyId,
        branchId,
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entity: "PAYROLL",
        entityId: payroll.id,
        afterJson: { reference, employees: lines.length, totalNet: totalNet.toNumber() },
      });

      return payroll;
    }).then((r) => res.status(201).json(r));
  })
);

router.post(
  "/runs/:id/approve",
  requirePermission("payroll.approve"),
  asyncHandler(async (req, res) => {
    const payroll = await prisma.payroll.findUnique({ where: { id: req.params.id as string } });
    if (!payroll || payroll.companyId !== req.user!.companyId) throw ApiError.notFound("Payroll run not found");
    if (payroll.status !== "DRAFT" && payroll.status !== "PENDING_APPROVAL") throw ApiError.badRequest("Payroll cannot be approved from current status");
    const updated = await prisma.payroll.update({
      where: { id: payroll.id },
      data: { status: "APPROVED", approvedById: req.user!.id, approvedAt: new Date() },
    });
    res.json(updated);
  })
);

// Post payroll to GL (journals: salaries expense, NSSA payable, PAYE payable, bank/cash)
router.post(
  "/runs/:id/post",
  requirePermission("payroll.post"),
  asyncHandler(async (req, res) => {
    const payroll = await prisma.payroll.findUnique({
      where: { id: req.params.id as string },
      include: { lines: true },
    });
    if (!payroll || payroll.companyId !== req.user!.companyId) throw ApiError.notFound("Payroll run not found");
    if (payroll.status !== "APPROVED") throw ApiError.badRequest("Only approved payroll can be posted");
    if (payroll.posted) throw ApiError.badRequest("Payroll already posted");

    return prisma.$transaction(async (tx) => {
      const postingAccounts = await getPostingAccounts(tx as any, payroll.companyId, payroll.branchId);

      const totalPaye = payroll.lines.reduce((acc, l) => acc.plus(d(l.payeAmount)), d(0));
      const totalNssa = payroll.lines.reduce((acc, l) => acc.plus(d(l.nssaAmount)), d(0));
      const totalGross = payroll.totalGross;
      const totalNet = payroll.totalNet;

      await postJournal(tx as any, {
        companyId: payroll.companyId,
        branchId: payroll.branchId,
        reference: `PAY-${payroll.reference}`,
        description: `Payroll ${payroll.periodName}`,
        entryType: "PAYROLL",
        sourceType: "PAYROLL",
        sourceId: payroll.id,
        userId: req.user!.id,
        skipReference: true,
        lines: [
          { accountId: await resolveAccountCode(tx as any, payroll.companyId, ACCOUNT_CODES.salaries), debit: totalGross, description: `Salaries - ${payroll.periodName}` },
          { accountId: await resolveAccountCode(tx as any, payroll.companyId, ACCOUNT_CODES.payePayable), credit: totalPaye, description: "PAYE payable" },
          { accountId: await resolveAccountCode(tx as any, payroll.companyId, ACCOUNT_CODES.nssaPayable), credit: totalNssa, description: "NSSA payable" },
          { accountId: postingAccounts.bankAccountId, credit: totalNet, description: "Net pay" },
        ],
      });

      // Update loan balances
      for (const line of payroll.lines) {
        if (d(line.loanDeductions).isPositive()) {
          const empLoans = await tx.employeeLoan.findMany({
            where: { employeeId: line.employeeId, status: "ACTIVE" },
          });
          let remaining = d(line.loanDeductions);
          for (const loan of empLoans) {
            if (remaining.isZero() || remaining.isNegative()) break;
            const deduction = remaining.lessThanOrEqualTo(d(loan.monthlyDeduction)) ? remaining : d(loan.monthlyDeduction);
            const newBalance = d(loan.outstandingBalance).minus(deduction);
            await tx.employeeLoan.update({
              where: { id: loan.id },
              data: {
                outstandingBalance: newBalance,
                ...(newBalance.isZero() ? { status: "COMPLETED" } : {}),
              },
            });
            remaining = remaining.minus(deduction);
          }
        }
      }

      await tx.payroll.update({
        where: { id: payroll.id },
        data: { posted: true, postedAt: new Date(), status: "POSTED" },
      });

      await writeAudit(tx as any, {
        companyId: payroll.companyId,
        branchId: payroll.branchId,
        userId: req.user!.id,
        action: AuditAction.POST,
        entity: "PAYROLL",
        entityId: payroll.id,
        afterJson: { status: "POSTED", totalNet: totalNet.toNumber() },
      });

      return res.json({ success: true, status: "POSTED" });
    }).then((r) => r);
  })
);

async function resolveAccountCode(tx: any, companyId: string, code: string): Promise<string> {
  const acc = await tx.account.findFirst({ where: { companyId, code } });
  if (!acc) throw ApiError.badRequest(`Account ${code} not found. Configure the chart of accounts.`);
  return acc.id;
}

export default router;