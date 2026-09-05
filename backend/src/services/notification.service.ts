import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

type Tx = Prisma.TransactionClient;

export interface NotificationInput {
  companyId: string;
  type: string;
  title: string;
  message?: string;
  entityType?: string;
  entityId?: string;
  branchId?: string | null;
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  userIds?: string[]; // target users
}

export async function createNotification(tx: Tx, input: NotificationInput): Promise<void> {
  const notification = await tx.notification.create({
    data: {
      companyId: input.companyId,
      type: input.type,
      title: input.title,
      message: input.message,
      entityType: input.entityType,
      entityId: input.entityId,
      branchId: input.branchId,
      priority: input.priority ?? "NORMAL",
    },
  });

  if (input.userIds && input.userIds.length > 0) {
    await tx.userNotification.createMany({
      data: input.userIds.map((userId) => ({ userId, notificationId: notification.id })),
    });
  }
}

// Find users for a branch by role names (used for approvals etc)
export async function notifyBranchRoleUsers(
  tx: Tx,
  companyId: string,
  branchId: string | null,
  roleNames: string[],
  input: Omit<NotificationInput, "userIds" | "companyId">
): Promise<void> {
  const users = await tx.user.findMany({
    where: {
      companyId,
      OR: [
        { branchId },
        { canViewAllBranches: true },
      ],
      isActive: true,
      roles: { some: { role: { name: { in: roleNames } } } },
    },
    select: { id: true },
  });
  await createNotification(tx, { ...input, companyId, userIds: users.map((u) => u.id) });
}