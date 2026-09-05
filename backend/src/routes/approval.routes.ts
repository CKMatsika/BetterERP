import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { asyncHandler, parsePagination } from "../utils/handlers";
import { validateBody } from "../middleware/validate";
import { requirePermission, effectiveBranchId } from "../middleware/auth";
import { actOnApproval, getRequestStatus } from "../services/approval.service";
import { writeAudit } from "../services/audit.service";
import { AuditAction } from "@prisma/client";

const router = Router();

// GET /api/approvals - list approval requests
router.get(
  "/",
  requirePermission("approval.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const where: Prisma.ApprovalRequestWhereInput = { companyId: req.user!.companyId };
    const branchId = effectiveBranchId(req);
    if (!req.user!.canViewAllBranches && branchId) where.branchId = branchId;
    if (req.query.status as string) where.status = req.query.status as string;
    if (req.query.entityType as string) where.entityType = req.query.entityType as string;
    if (req.query.mine as string === "true") where.requestedById = req.user!.id;

    const [total, items] = await Promise.all([
      prisma.approvalRequest.count({ where }),
      prisma.approvalRequest.findMany({
        where,
        include: {
          actions: { orderBy: { actionAt: "desc" }, include: { } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
    ]);
    res.json({ items, total, page, pageSize });
  })
);

// GET pending approvals for current user's role (approvals I can act on)
router.get(
  "/my-pending",
  requirePermission("approval.view"),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { roles: true },
    });
    if (!user) throw ApiError.notFound("User not found");
    const userRoleIds = user.roles.map((r) => r.roleId);

    // Find workflows where current level matches a role the user has
    const workflows = await prisma.approvalWorkflow.findMany({
      where: { companyId: user.companyId },
      include: { levels: true },
    });

    const entityTypes = workflows
      .filter((wf) => wf.levels.some((l) => userRoleIds.includes(l.roleId ?? "")))
      .map((wf) => wf.entityType);

    const requests = await prisma.approvalRequest.findMany({
      where: {
        companyId: user.companyId,
        status: "PENDING",
        entityType: { in: entityTypes },
        ...(!user.canViewAllBranches && user.branchId ? { branchId: user.branchId } : {}),
      },
      include: { actions: true },
      orderBy: { createdAt: "asc" },
    });

    res.json({ items: requests });
  })
);

// GET /api/approvals/:id
router.get(
  "/:id",
  requirePermission("approval.view"),
  asyncHandler(async (req, res) => {
    const request = await prisma.approvalRequest.findUnique({
      where: { id: req.params.id as string },
      include: { actions: true },
    });
    if (!request || request.companyId !== req.user!.companyId) throw ApiError.notFound("Approval request not found");
    res.json(request);
  })
);

// POST /api/approvals/:id/approve
router.post(
  "/:id/approve",
  requirePermission("approval.manage"),
  validateBody(z.object({ comments: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const result = await actOnApproval(req.user!.id, req.params.id as string, "APPROVE", req.body.comments);
    await writeAudit(prisma as any, {
      companyId: req.user!.companyId,
      userId: req.user!.id,
      action: AuditAction.APPROVE,
      entity: "APPROVAL_REQUEST",
      entityId: req.params.id as string,
      afterJson: { status: result.status },
    });
    res.json(result);
  })
);

// POST /api/approvals/:id/reject
router.post(
  "/:id/reject",
  requirePermission("approval.manage"),
  validateBody(z.object({ comments: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const result = await actOnApproval(req.user!.id, req.params.id as string, "REJECT", req.body.comments);
    await writeAudit(prisma as any, {
      companyId: req.user!.companyId,
      userId: req.user!.id,
      action: AuditAction.REJECT,
      entity: "APPROVAL_REQUEST",
      entityId: req.params.id as string,
      afterJson: { status: result.status },
    });
    res.json(result);
  })
);

// GET status of an entity's approval
router.get(
  "/status/:entityType/:entityId",
  requirePermission("approval.view"),
  asyncHandler(async (req, res) => {
    const status = await getRequestStatus(req.params.entityType as string, req.params.entityId as string);
    res.json({ status });
  })
);

export default router;