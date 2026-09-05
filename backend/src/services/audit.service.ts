import { Prisma, AuditAction } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";

type Tx = Prisma.TransactionClient;

export interface AuditInput {
  companyId: string;
  branchId?: string | null;
  userId?: string | null;
  role?: string | null;
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  beforeJson?: unknown;
  afterJson?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  description?: string;
}

export async function writeAudit(tx: Tx, input: AuditInput): Promise<void> {
  try {
    await tx.auditLog.create({
      data: {
        companyId: input.companyId,
        branchId: input.branchId,
        userId: input.userId,
        role: input.role,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        beforeJson: input.beforeJson as Prisma.InputJsonValue | undefined,
        afterJson: input.afterJson as Prisma.InputJsonValue | undefined,
        ip: input.ip,
        userAgent: input.userAgent,
        description: input.description,
      },
    });
  } catch (err) {
    // Never let audit failures break the business operation
    logger.error("Failed to write audit log", err);
  }
}

// Simplifies audit writing from Express handlers
export function auditFromReq(
  req: { user?: { id?: string; roles?: string[]; companyId?: string; branchId?: string | null }; ip?: string; get?: (h: string) => string | undefined },
  action: AuditAction,
  entity: string,
  entityId?: string,
  after?: unknown,
  before?: unknown,
  description?: string
): AuditInput {
  return {
    companyId: req.user?.companyId ?? "",
    branchId: req.user?.branchId ?? null,
    userId: req.user?.id ?? null,
    role: req.user?.roles?.[0] ?? null,
    action,
    entity,
    entityId,
    afterJson: after,
    beforeJson: before,
    ip: req.ip ?? null,
    userAgent: req.get ? (req.get("user-agent") ?? undefined) : undefined,
    description,
  };
}