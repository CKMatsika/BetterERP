import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { asyncHandler } from "../utils/handlers";
import { validateBody } from "../middleware/validate";
import { requirePermission } from "../middleware/auth";
import { writeAudit } from "../services/audit.service";
import { AuditAction } from "@prisma/client";

const router = Router();

// GET all settings (grouped)
router.get(
  "/",
  requirePermission("setting.view"),
  asyncHandler(async (req, res) => {
    const where: Prisma.AppSettingWhereInput = { companyId: req.user!.companyId };
    if (req.query.group as string) where.group = req.query.group as string;
    const items = await prisma.appSetting.findMany({
      where,
      orderBy: [{ group: "asc" }, { key: "asc" }],
    });

    // Group by group
    const grouped: Record<string, any[]> = {};
    items.forEach((s) => {
      if (!grouped[s.group]) grouped[s.group] = [];
      grouped[s.group].push(s);
    });
    res.json({ items, grouped });
  })
);

// GET by group
router.get(
  "/:group",
  requirePermission("setting.view"),
  asyncHandler(async (req, res) => {
    const items = await prisma.appSetting.findMany({
      where: { companyId: req.user!.companyId, group: req.params.group as string },
      orderBy: { key: "asc" },
    });
    res.json({ items });
  })
);

// PUT bulk update settings
router.put(
  "/",
  requirePermission("setting.edit"),
  validateBody(z.object({
    settings: z.array(z.object({
      group: z.string(),
      key: z.string(),
      value: z.string(),
      dataType: z.enum(["STRING", "NUMBER", "BOOLEAN", "JSON"]).optional(),
      isPublic: z.boolean().optional(),
    })).min(1),
  })),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const results: any[] = [];
    for (const s of req.body.settings) {
      const existing = await prisma.appSetting.findUnique({
        where: { companyId_group_key: { companyId, group: s.group, key: s.key } },
      });
      if (existing) {
        const updated = await prisma.appSetting.update({
          where: { id: existing.id },
          data: { value: s.value, ...(s.dataType ? { dataType: s.dataType } : {}), ...(s.isPublic !== undefined ? { isPublic: s.isPublic } : {}) },
        });
        results.push(updated);
      } else {
        const created = await prisma.appSetting.create({
          data: { companyId, ...s },
        });
        results.push(created);
      }
    }

    await writeAudit(prisma as any, {
      companyId,
      userId: req.user!.id,
      action: AuditAction.UPDATE,
      entity: "APP_SETTING",
      afterJson: { updatedKeys: results.map((r) => `${r.group}.${r.key}`) },
      description: `Updated ${results.length} settings`,
    });
    res.json({ items: results });
  })
);

// DELETE a setting
router.delete(
  "/:group/:key",
  requirePermission("setting.edit"),
  asyncHandler(async (req, res) => {
    const setting = await prisma.appSetting.findUnique({
      where: { companyId_group_key: { companyId: req.user!.companyId, group: req.params.group as string, key: req.params.key as string } },
    });
    if (!setting) throw ApiError.notFound("Setting not found");
    await prisma.appSetting.delete({ where: { id: setting.id } });
    res.json({ success: true });
  })
);

// APPROVAL WORKFLOWS

router.get(
  "/approval-workflows",
  requirePermission("setting.view"),
  asyncHandler(async (req, res) => {
    const items = await prisma.approvalWorkflow.findMany({
      where: { companyId: req.user!.companyId },
      include: { levels: { orderBy: { level: "asc" }, include: { role: { select: { id: true, name: true } } } } },
      orderBy: { entityType: "asc" },
    });
    res.json({ items });
  })
);

router.post(
  "/approval-workflows",
  requirePermission("setting.edit"),
  validateBody(z.object({
    name: z.string().min(1),
    entityType: z.string().min(1),
    levels: z.array(z.object({
      level: z.number().int().positive(),
      roleId: z.string().optional().nullable(),
      minAmount: z.coerce.number().optional().nullable(),
      maxAmount: z.coerce.number().optional().nullable(),
    })).min(1),
  })),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const existing = await prisma.approvalWorkflow.findUnique({
      where: { companyId_entityType: { companyId, entityType: req.body.entityType } },
    });
    if (existing) throw ApiError.badRequest("Workflow already exists for this entity type");

    return prisma.$transaction(async (tx) => {
      const workflow = await tx.approvalWorkflow.create({
        data: {
          companyId,
          name: req.body.name,
          entityType: req.body.entityType,
          levels: {
            create: req.body.levels.map((l: any) => ({
              level: l.level,
              roleId: l.roleId,
              minAmount: l.minAmount,
              maxAmount: l.maxAmount,
            })),
          },
        },
        include: { levels: true },
      });
      return workflow;
    }).then((r) => res.status(201).json(r));
  })
);

router.delete(
  "/approval-workflows/:id",
  requirePermission("setting.edit"),
  asyncHandler(async (req, res) => {
    const wf = await prisma.approvalWorkflow.findUnique({ where: { id: req.params.id as string } });
    if (!wf || wf.companyId !== req.user!.companyId) throw ApiError.notFound("Workflow not found");
    await prisma.approvalWorkflow.delete({ where: { id: wf.id } });
    res.json({ success: true });
  })
);

export default router;