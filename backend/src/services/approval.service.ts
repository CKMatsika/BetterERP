import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { d } from "../utils/money";

type Tx = Prisma.TransactionClient;

export interface ApprovalRequestInput {
  companyId: string;
  branchId?: string | null;
  entityType: string;
  entityId: string;
  entityRef?: string;
  requestedById?: string | null;
  amount?: Prisma.Decimal | string | number;
  workflowType?: string;
}

// Create an approval request against configured workflow levels
export async function createApprovalRequest(
  tx: Tx,
  input: ApprovalRequestInput
): Promise<string | null> {
  // Find configured workflow
  const workflow = await tx.approvalWorkflow.findFirst({
    where: { companyId: input.companyId, entityType: input.workflowType ?? input.entityType },
    include: { levels: { orderBy: { level: "asc" } } },
  });

  if (!workflow || workflow.levels.length === 0) {
    // No workflow configured -> auto-approve
    return null;
  }

  // Evaluate threshold (optional - if config has amounts, use levels)
  const amount = input.amount ? d(input.amount) : null;
  let firstLevel = workflow.levels[0];
  if (amount && firstLevel.maxAmount && amount.greaterThan(firstLevel.maxAmount)) {
    firstLevel = workflow.levels[workflow.levels.length - 1];
  }

  const request = await tx.approvalRequest.create({
    data: {
      companyId: input.companyId,
      branchId: input.branchId,
      entityType: input.entityType,
      entityId: input.entityId,
      entityRef: input.entityRef,
      requestedById: input.requestedById,
      status: "PENDING",
      currentLevel: firstLevel.level,
    },
  });

  return request.id;
}

// Decide whether the current user can approve a request (level + role)
export async function canApprove(
  userId: string,
  requestId: string
): Promise<{ can: boolean; request?: any }> {
  const request = await prisma.approvalRequest.findUnique({
    where: { id: requestId },
    include: {
      actions: true,
    },
  });
  if (!request) throw ApiError.notFound("Approval request not found");
  if (request.status !== "PENDING") throw ApiError.badRequest("Approval request is not pending");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: true },
  });
  if (!user) throw ApiError.notFound("User not found");

  // If no workflow levels specified, any user with approval.manage permission passes
  const userRoleNames = user.roles.map((r) => r.roleId);

  const workflow = await prisma.approvalWorkflow.findFirst({
    where: { companyId: user.companyId, entityType: request.entityType },
    include: { levels: true },
  });
  if (!workflow || workflow.levels.length === 0) {
    return { can: true, request };
  }

  const level = workflow.levels.find((l) => l.level === request.currentLevel);
  if (!level) return { can: false, request };
  if (!level.roleId) return { can: true, request };

  const userHasRole = user.roles.some((ur) => ur.roleId === level.roleId);
  return { can: userHasRole, request };
}

export async function actOnApproval(
  userId: string,
  requestId: string,
  action: "APPROVE" | "REJECT",
  comments?: string
): Promise<{ status: string }> {
  const { can, request } = await canApprove(userId, requestId);
  if (!can) throw ApiError.forbidden("You are not authorized to act on this approval");

  return prisma.$transaction(async (tx) => {
    await tx.approvalAction.create({
      data: {
        approvalRequestId: requestId,
        level: request.currentLevel,
        approverId: userId,
        action,
        comments,
      },
    });

    if (action === "REJECT") {
      await tx.approvalRequest.update({ where: { id: requestId }, data: { status: "REJECTED" } });
      return { status: "REJECTED" };
    }

    const workflow = await tx.approvalWorkflow.findFirst({
      where: { companyId: request.companyId, entityType: request.entityType },
      include: { levels: { orderBy: { level: "asc" } } },
    });
    const levelCount = workflow?.levels.length ?? 1;
    if (request.currentLevel >= levelCount) {
      await tx.approvalRequest.update({
        where: { id: requestId },
        data: { status: "APPROVED", approvedAt: new Date() },
      });
      return { status: "APPROVED" };
    }
    await tx.approvalRequest.update({
      where: { id: requestId },
      data: { currentLevel: request.currentLevel + 1 },
    });
    return { status: "PENDING" };
  });
}

export async function getRequestStatus(entityType: string, entityId: string): Promise<string> {
  const req = await prisma.approvalRequest.findFirst({
    where: { entityType, entityId },
    orderBy: { createdAt: "desc" },
  });
  return req?.status ?? "NOT_REQUIRED";
}