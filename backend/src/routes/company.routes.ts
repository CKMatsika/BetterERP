import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { asyncHandler } from "../utils/handlers";
import { validateBody } from "../middleware/validate";
import { requirePermission } from "../middleware/auth";

const router = Router();

const updateCompanySchema = z.object({
  name: z.string().min(1).optional(),
  legalName: z.string().optional().nullable(),
  registrationNumber: z.string().optional().nullable(),
  vatNumber: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  country: z.string().optional(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  website: z.string().optional().nullable(),
  currency: z.string().optional(),
  baseCurrency: z.string().optional(),
  fiscalYearStart: z.coerce.date().optional(),
  settings: z.record(z.string(), z.any()).optional(),
});

// GET /api/company/profile
router.get(
  "/profile",
  asyncHandler(async (req, res) => {
    const company = await prisma.company.findUnique({ where: { id: req.user!.companyId } });
    res.json(company);
  })
);

// PUT /api/company/profile
router.put(
  "/profile",
  requirePermission("company.edit"),
  validateBody(updateCompanySchema),
  asyncHandler(async (req, res) => {
    const company = await prisma.company.update({
      where: { id: req.user!.companyId },
      data: req.body,
    });
    res.json(company);
  })
);

// GET /api/company/departments
router.get(
  "/departments",
  requirePermission("department.view"),
  asyncHandler(async (req, res) => {
    const items = await prisma.department.findMany({
      where: { companyId: req.user!.companyId },
      orderBy: { name: "asc" },
      include: { employees: { select: { id: true, firstName: true, lastName: true } } },
    });
    res.json({ items });
  })
);

// POST /api/company/departments
router.post(
  "/departments",
  requirePermission("department.edit"),
  validateBody(z.object({ code: z.string().min(1), name: z.string().min(1), description: z.string().optional().nullable() })),
  asyncHandler(async (req, res) => {
    const dept = await prisma.department.create({
      data: { companyId: req.user!.companyId, ...req.body },
    });
    res.status(201).json(dept);
  })
);

// Cost centres
router.get(
  "/cost-centres",
  requirePermission("costcentre.view"),
  asyncHandler(async (req, res) => {
    const items = await prisma.costCentre.findMany({
      where: { companyId: req.user!.companyId },
      orderBy: { name: "asc" },
    });
    res.json({ items });
  })
);

router.post(
  "/cost-centres",
  requirePermission("costcentre.edit"),
  validateBody(z.object({ code: z.string().min(1), name: z.string().min(1), departmentId: z.string().optional().nullable(), description: z.string().optional().nullable() })),
  asyncHandler(async (req, res) => {
    const cc = await prisma.costCentre.create({ data: { companyId: req.user!.companyId, ...req.body } });
    res.status(201).json(cc);
  })
);

router.get(
  "/profit-centres",
  requirePermission("costcentre.view"),
  asyncHandler(async (req, res) => {
    const items = await prisma.profitCentre.findMany({
      where: { companyId: req.user!.companyId },
      orderBy: { name: "asc" },
    });
    res.json({ items });
  })
);

router.post(
  "/profit-centres",
  requirePermission("costcentre.edit"),
  validateBody(z.object({ code: z.string().min(1), name: z.string().min(1), departmentId: z.string().optional().nullable(), description: z.string().optional().nullable() })),
  asyncHandler(async (req, res) => {
    const pc = await prisma.profitCentre.create({ data: { companyId: req.user!.companyId, ...req.body } });
    res.status(201).json(pc);
  })
);

export default router;