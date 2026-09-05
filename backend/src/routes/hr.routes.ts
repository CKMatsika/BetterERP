import { Router } from "express";
import { z } from "zod";
import { Prisma, EmploymentStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { asyncHandler, parsePagination } from "../utils/handlers";
import { validateBody } from "../middleware/validate";
import { requirePermission, effectiveBranchId } from "../middleware/auth";
import { writeAudit } from "../services/audit.service";
import { AuditAction } from "@prisma/client";
import { nextReference } from "../services/sequence.service";
import { d } from "../utils/money";

const router = Router();

// ==================== POSITIONS ====================

router.get(
  "/positions",
  requirePermission("employee.view"),
  asyncHandler(async (req, res) => {
    const items = await prisma.position.findMany({
      where: { companyId: req.user!.companyId },
      orderBy: { name: "asc" },
    });
    res.json({ items });
  })
);

router.post(
  "/positions",
  requirePermission("employee.create"),
  validateBody(z.object({ name: z.string().min(1), description: z.string().optional().nullable(), departmentId: z.string().optional().nullable() })),
  asyncHandler(async (req, res) => {
    const existing = await prisma.position.findUnique({
      where: { companyId_name: { companyId: req.user!.companyId, name: req.body.name } },
    });
    if (existing) throw ApiError.badRequest("Position name already exists");
    const pos = await prisma.position.create({ data: { companyId: req.user!.companyId, ...req.body } });
    res.status(201).json(pos);
  })
);

// ==================== EMPLOYEES ====================

const employeeSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  middleName: z.string().optional().nullable(),
  dateOfBirth: z.coerce.date().optional().nullable(),
  gender: z.string().optional().nullable(),
  nationalId: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  positionId: z.string().optional().nullable(),
  managerId: z.string().optional().nullable(),
  employmentType: z.string().default("FULL_TIME"),
  hireDate: z.coerce.date().optional(),
  salaryType: z.string().default("MONTHLY"),
  basicSalary: z.coerce.number().optional(),
  hourlyRate: z.coerce.number().optional(),
  bankName: z.string().optional().nullable(),
  bankAccountNumber: z.string().optional().nullable(),
  bankBranch: z.string().optional().nullable(),
  nssaNumber: z.string().optional().nullable(),
  taxNumber: z.string().optional().nullable(),
  branchId: z.string().optional(),
});

router.get(
  "/employees",
  requirePermission("employee.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const where: Prisma.EmployeeWhereInput = { companyId: req.user!.companyId };
    const branchId = effectiveBranchId(req);
    if (!req.user!.canViewAllBranches && branchId) where.branchId = branchId;
    if (req.query.branchId as string) where.branchId = req.query.branchId as string;
    if (req.query.departmentId as string) where.departmentId = req.query.departmentId as string;
    if (req.query.status as string) where.employmentStatus = req.query.status as any;
    if (req.query.search as string) {
      const q = req.query.search as string;
      where.OR = [
        { employeeNumber: { contains: q, mode: "insensitive" } },
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { nationalId: { contains: q, mode: "insensitive" } },
      ];
    }
    const [total, items] = await Promise.all([
      prisma.employee.count({ where }),
      prisma.employee.findMany({
        where,
        include: {
          department: { select: { id: true, name: true, code: true } },
          position: { select: { id: true, name: true } },
          user: { select: { id: true, username: true, isActive: true } },
        },
        orderBy: { employeeNumber: "asc" },
        skip,
        take: pageSize,
      }),
    ]);
    res.json({ items, total, page, pageSize });
  })
);

router.get(
  "/employees/:id",
  requirePermission("employee.view"),
  asyncHandler(async (req, res) => {
    const emp = await prisma.employee.findUnique({
      where: { id: req.params.id as string },
      include: {
        department: true,
        position: true,
        user: { select: { id: true, username: true, email: true, isActive: true } },
        allowances: true,
        deductions: true,
        loans: { where: { status: "ACTIVE" } },
        documents: true,
      },
    });
    if (!emp || emp.companyId !== req.user!.companyId) throw ApiError.notFound("Employee not found");
    res.json(emp);
  })
);

router.post(
  "/employees",
  requirePermission("employee.create"),
  validateBody(employeeSchema),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    return prisma.$transaction(async (tx) => {
      const empNumber = await nextReference({ companyId, branchId: req.body.branchId, docType: "EMPLOYEE" });
      const emp = await tx.employee.create({
        data: {
          companyId,
          employeeNumber: empNumber,
          branchId: req.body.branchId ?? req.user!.branchId,
          ...req.body,
        },
      });
      await writeAudit(tx as any, {
        companyId,
        branchId: req.body.branchId ?? req.user!.branchId,
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entity: "EMPLOYEE",
        entityId: emp.id,
        afterJson: { employeeNumber: empNumber, name: `${req.body.firstName} ${req.body.lastName}` },
      });
      return emp;
    }).then((r) => res.status(201).json(r));
  })
);

router.post(
  "/employees/import",
  requirePermission("employee.import"),
  asyncHandler(async (req, res) => {
    const rows = req.body?.rows as Array<Record<string, string>>;
    if (!Array.isArray(rows) || rows.length === 0) throw ApiError.badRequest("No rows provided");
    const errors: Array<{ row: number; error: string }> = [];
    let created = 0;
    await prisma.$transaction(async (tx) => {
      for (let index = 0; index < rows.length; index += 1) {
        try {
          const row = rows[index];
          if (!row.firstName?.trim() || !row.lastName?.trim()) throw new Error("firstName and lastName are required");
          const branchId = row.branchId || req.user!.branchId;
          const employeeNumber = row.employeeNumber?.trim() || await nextReference({ companyId: req.user!.companyId, branchId, docType: "EMPLOYEE" });
          const existing = await tx.employee.findUnique({ where: { employeeNumber } });
          if (existing) throw new Error(`Employee number ${employeeNumber} already exists`);
          await tx.employee.create({ data: { companyId: req.user!.companyId, employeeNumber, userId: null, branchId, firstName: row.firstName.trim(), lastName: row.lastName.trim(), middleName: row.middleName || null, nationalId: row.nationalId || null, phone: row.phone || null, email: row.email || null, employmentType: row.employmentType || "FULL_TIME", salaryType: row.salaryType || "MONTHLY", basicSalary: row.basicSalary ? d(row.basicSalary) : undefined, hireDate: row.hireDate ? new Date(row.hireDate) : undefined } });
          created += 1;
        } catch (error) { errors.push({ row: index + 2, error: error instanceof Error ? error.message : "Invalid row" }); }
      }
    });
    res.json({ success: true, summary: { total: rows.length, created, updated: 0, skipped: 0, errors: errors.length }, errors: errors.slice(0, 50) });
  })
);

router.put(
  "/employees/:id",
  requirePermission("employee.edit"),
  validateBody(employeeSchema.partial()),
  asyncHandler(async (req, res) => {
    const emp = await prisma.employee.findUnique({ where: { id: req.params.id as string } });
    if (!emp || emp.companyId !== req.user!.companyId) throw ApiError.notFound("Employee not found");
    const updated = await prisma.employee.update({ where: { id: emp.id }, data: req.body });
    res.json(updated);
  })
);

// Terminate / reactivate employee
router.post(
  "/employees/:id/status",
  requirePermission("employee.edit"),
  validateBody(z.object({ status: z.nativeEnum(EmploymentStatus), terminationDate: z.coerce.date().optional() })),
  asyncHandler(async (req, res) => {
    const emp = await prisma.employee.findUnique({ where: { id: req.params.id as string } });
    if (!emp || emp.companyId !== req.user!.companyId) throw ApiError.notFound("Employee not found");
    const updated = await prisma.employee.update({
      where: { id: emp.id },
      data: { employmentStatus: req.body.status, terminationDate: req.body.terminationDate },
    });
    res.json(updated);
  })
);

// Employee allowances
router.get(
  "/employees/:employeeId/allowances",
  requirePermission("employee.view"),
  asyncHandler(async (req, res) => {
    const items = await prisma.employeeAllowance.findMany({
      where: { employeeId: req.params.employeeId as string, employee: { companyId: req.user!.companyId } },
      orderBy: { name: "asc" },
    });
    res.json({ items });
  })
);

router.post(
  "/employees/:employeeId/allowances",
  requirePermission("employee.edit"),
  validateBody(z.object({ name: z.string().min(1), type: z.enum(["FIXED", "PERCENTAGE"]), amount: z.coerce.number().min(0), percentage: z.coerce.number().optional(), isTaxable: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const emp = await prisma.employee.findUnique({ where: { id: req.params.employeeId as string } });
    if (!emp || emp.companyId !== req.user!.companyId) throw ApiError.notFound("Employee not found");
    const allowance = await prisma.employeeAllowance.create({
      data: { employeeId: emp.id, ...req.body },
    });
    res.status(201).json(allowance);
  })
);

router.delete(
  "/employees/:employeeId/allowances/:id",
  requirePermission("employee.edit"),
  asyncHandler(async (req, res) => {
    await prisma.employeeAllowance.delete({ where: { id: req.params.id as string } });
    res.json({ success: true });
  })
);

// Employee deductions
router.get(
  "/employees/:employeeId/deductions",
  requirePermission("employee.view"),
  asyncHandler(async (req, res) => {
    const items = await prisma.employeeDeduction.findMany({
      where: { employeeId: req.params.employeeId as string, employee: { companyId: req.user!.companyId } },
      orderBy: { name: "asc" },
    });
    res.json({ items });
  })
);

router.post(
  "/employees/:employeeId/deductions",
  requirePermission("employee.edit"),
  validateBody(z.object({ name: z.string().min(1), type: z.enum(["FIXED", "PERCENTAGE"]), amount: z.coerce.number().min(0), percentage: z.coerce.number().optional(), isStatutory: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const emp = await prisma.employee.findUnique({ where: { id: req.params.employeeId as string } });
    if (!emp || emp.companyId !== req.user!.companyId) throw ApiError.notFound("Employee not found");
    const deduction = await prisma.employeeDeduction.create({
      data: { employeeId: emp.id, ...req.body },
    });
    res.status(201).json(deduction);
  })
);

router.delete(
  "/employees/:employeeId/deductions/:id",
  requirePermission("employee.edit"),
  asyncHandler(async (req, res) => {
    await prisma.employeeDeduction.delete({ where: { id: req.params.id as string } });
    res.json({ success: true });
  })
);

// Employee loans
router.get(
  "/employees/:employeeId/loans",
  requirePermission("employee.view"),
  asyncHandler(async (req, res) => {
    const items = await prisma.employeeLoan.findMany({
      where: { employeeId: req.params.employeeId as string, employee: { companyId: req.user!.companyId } },
      orderBy: { createdAt: "desc" },
    });
    res.json({ items });
  })
);

router.post(
  "/employees/:employeeId/loans",
  requirePermission("employee.edit"),
  validateBody(z.object({
    amount: z.coerce.number().positive(),
    monthlyDeduction: z.coerce.number().positive(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  })),
  asyncHandler(async (req, res) => {
    const emp = await prisma.employee.findUnique({ where: { id: req.params.employeeId as string } });
    if (!emp || emp.companyId !== req.user!.companyId) throw ApiError.notFound("Employee not found");
    const loan = await prisma.employeeLoan.create({
      data: { employeeId: emp.id, ...req.body, outstandingBalance: req.body.amount },
    });
    res.status(201).json(loan);
  })
);

// ==================== ATTENDANCE ====================

const attendanceSchema = z.object({
  employeeId: z.string(),
  date: z.coerce.date(),
  clockIn: z.coerce.date().optional().nullable(),
  clockOut: z.coerce.date().optional().nullable(),
  hoursWorked: z.coerce.number().optional(),
  status: z.enum(["PRESENT", "ABSENT", "LATE", "LEAVE"]).default("PRESENT"),
  note: z.string().optional().nullable(),
});

router.get(
  "/attendance",
  requirePermission("employee.view"),
  asyncHandler(async (req, res) => {
    const where: Prisma.AttendanceWhereInput = { companyId: req.user!.companyId };
    const branchId = effectiveBranchId(req);
    if (!req.user!.canViewAllBranches && branchId) where.branchId = branchId;
    if (req.query.branchId as string) where.branchId = req.query.branchId as string;
    if (req.query.employeeId as string) where.employeeId = req.query.employeeId as string;
    if (req.query.date as string) where.date = new Date(req.query.date as string);
    if (req.query.from as string || req.query.to as string) {
      where.date = {
        gte: req.query.from as string ? new Date(req.query.from as string) : undefined,
        lte: req.query.to as string ? new Date(req.query.to as string) : undefined,
      };
    }
    const items = await prisma.attendance.findMany({
      where,
      include: { employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true } } },
      orderBy: { date: "desc" },
      take: 200,
    });
    res.json({ items });
  })
);

router.post(
  "/attendance",
  requirePermission("employee.edit"),
  validateBody(attendanceSchema),
  asyncHandler(async (req, res) => {
    const emp = await prisma.employee.findUnique({ where: { id: req.body.employeeId } });
    if (!emp || emp.companyId !== req.user!.companyId) throw ApiError.notFound("Employee not found");
    const existing = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: req.body.employeeId, date: new Date(req.body.date).toISOString().split("T")[0] as any } },
    });
    if (existing) throw ApiError.badRequest("Attendance already recorded for this date");
    const attendance = await prisma.attendance.create({
      data: {
        companyId: req.user!.companyId,
        branchId: emp.branchId,
        ...req.body,
      },
    });
    res.status(201).json(attendance);
  })
);

// ==================== LEAVE REQUESTS ====================

const leaveSchema = z.object({
  employeeId: z.string(),
  leaveType: z.enum(["ANNUAL", "SICK", "MATERNITY", "PATERNITY", "UNPAID", "COMPASSIONATE", "STUDY", "OTHER"]),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  days: z.number().int().positive(),
  reason: z.string().optional().nullable(),
});

router.get(
  "/leave",
  requirePermission("leave.view"),
  asyncHandler(async (req, res) => {
    const where: Prisma.LeaveRequestWhereInput = { companyId: req.user!.companyId };
    const branchId = effectiveBranchId(req);
    if (!req.user!.canViewAllBranches && branchId) where.branchId = branchId;
    if (req.query.status as string) where.status = req.query.status as any;
    if (req.query.employeeId as string) where.employeeId = req.query.employeeId as string;
    const items = await prisma.leaveRequest.findMany({
      where,
      include: { employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true, department: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" },
    });
    res.json({ items });
  })
);

router.post(
  "/leave",
  requirePermission("employee.create"),
  validateBody(leaveSchema),
  asyncHandler(async (req, res) => {
    const emp = await prisma.employee.findUnique({ where: { id: req.body.employeeId } });
    if (!emp || emp.companyId !== req.user!.companyId) throw ApiError.notFound("Employee not found");
    const request = await prisma.leaveRequest.create({
      data: {
        companyId: req.user!.companyId,
        branchId: emp.branchId,
        ...req.body,
      },
    });
    res.status(201).json(request);
  })
);

router.post(
  "/leave/:id/approve",
  requirePermission("leave.approve"),
  asyncHandler(async (req, res) => {
    const leave = await prisma.leaveRequest.findUnique({ where: { id: req.params.id as string } });
    if (!leave || leave.companyId !== req.user!.companyId) throw ApiError.notFound("Leave request not found");
    if (leave.status !== "PENDING") throw ApiError.badRequest("Leave request is not pending");
    const updated = await prisma.leaveRequest.update({
      where: { id: leave.id },
      data: { status: "APPROVED", approvedById: req.user!.id, approvedAt: new Date() },
    });
    res.json(updated);
  })
);

router.post(
  "/leave/:id/reject",
  requirePermission("leave.approve"),
  asyncHandler(async (req, res) => {
    const leave = await prisma.leaveRequest.findUnique({ where: { id: req.params.id as string } });
    if (!leave || leave.companyId !== req.user!.companyId) throw ApiError.notFound("Leave request not found");
    const updated = await prisma.leaveRequest.update({
      where: { id: leave.id },
      data: { status: "REJECTED" },
    });
    res.json(updated);
  })
);

// ==================== EMPLOYEE DOCUMENTS ====================

router.get(
  "/employees/:employeeId/documents",
  requirePermission("employee.view"),
  asyncHandler(async (req, res) => {
    const items = await prisma.employeeDocument.findMany({
      where: { employeeId: req.params.employeeId as string, employee: { companyId: req.user!.companyId } },
      orderBy: { uploadedAt: "desc" },
    });
    res.json({ items });
  })
);

router.post(
  "/employees/:employeeId/documents",
  requirePermission("employee.edit"),
  validateBody(z.object({ name: z.string().min(1), type: z.string().min(1), filePath: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const emp = await prisma.employee.findUnique({ where: { id: req.params.employeeId as string } });
    if (!emp || emp.companyId !== req.user!.companyId) throw ApiError.notFound("Employee not found");
    const doc = await prisma.employeeDocument.create({
      data: { employeeId: emp.id, ...req.body, uploadedById: req.user!.id },
    });
    res.status(201).json(doc);
  })
);

export default router;