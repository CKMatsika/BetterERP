import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { asyncHandler, parsePagination } from "../utils/handlers";
import { validateBody } from "../middleware/validate";
import { requirePermission } from "../middleware/auth";
import { env } from "../config";
import { writeAudit } from "../services/audit.service";
import { AuditAction } from "@prisma/client";

const router = Router();

const permissionSchema = z.object({
  roleId: z.string(),
  permissionIds: z.array(z.string()),
});

const roleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  permissionIds: z.array(z.string()).optional(),
});

const userCreateSchema = z.object({
  username: z.string().min(3),
  email: z.string().email().optional().nullable(),
  fullName: z.string().min(1),
  phone: z.string().optional().nullable(),
  branchId: z.string().optional().nullable(),
  password: z.string().min(8).default("Admin123!").optional(),
  roleIds: z.array(z.string()).optional(),
  canViewAllBranches: z.boolean().optional(),
  mustChangePassword: z.boolean().optional().default(true),
});

const userUpdateSchema = z.object({
  email: z.string().email().optional().nullable(),
  fullName: z.string().min(1).optional(),
  phone: z.string().optional().nullable(),
  branchId: z.string().optional().nullable(),
  roleIds: z.array(z.string()).optional(),
  canViewAllBranches: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

// ===== PERMISSIONS =====
router.get(
  "/permissions",
  asyncHandler(async (req, res) => {
    const permissions = await prisma.permission.findMany({ orderBy: [{ module: "asc" }, { resource: "asc" }] });
    res.json({ items: permissions });
  })
);

// ===== ROLES =====
router.get(
  "/roles",
  requirePermission("role.view"),
  asyncHandler(async (req, res) => {
    const roles = await prisma.role.findMany({
      where: { companyId: req.user!.companyId },
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
      orderBy: { name: "asc" },
    });
    res.json({ items: roles });
  })
);

router.post(
  "/roles",
  requirePermission("role.create"),
  validateBody(roleSchema),
  asyncHandler(async (req, res) => {
    const { permissionIds, ...data } = req.body;
    const role = await prisma.role.create({
      data: {
        companyId: req.user!.companyId,
        name: data.name,
        description: data.description,
        ...(permissionIds && permissionIds.length > 0
          ? {
              permissions: {
                createMany: {
                  data: permissionIds.map((permissionId: string) => ({ permissionId })),
                },
              },
            }
          : {}),
      },
      include: { permissions: { include: { permission: true } } },
    });
    await writeAudit(prisma as any, {
      companyId: req.user!.companyId,
      branchId: req.user!.branchId,
      userId: req.user!.id,
      action: AuditAction.CREATE,
      entity: "ROLE",
      entityId: role.id,
      description: `Created role ${role.name}`,
    });
    res.status(201).json(role);
  })
);

router.put(
  "/roles/:id",
  requirePermission("role.edit"),
  validateBody(roleSchema.partial()),
  asyncHandler(async (req, res) => {
    const role = await prisma.role.findUnique({ where: { id: req.params.id as string } });
    if (!role || role.companyId !== req.user!.companyId) throw ApiError.notFound("Role not found");

    const { permissionIds, ...data } = req.body;
    const updated = await prisma.$transaction(async (tx) => {
      const roleUpdate = await tx.role.update({
        where: { id: role.id },
        data,
      });
      if (permissionIds) {
        await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
        if (permissionIds.length > 0) {
          await tx.rolePermission.createMany({
            data: permissionIds.map((permissionId: string) => ({ roleId: role.id, permissionId })),
          });
        }
      }
      return roleUpdate;
    });

    await writeAudit(prisma as any, {
      companyId: req.user!.companyId,
      branchId: req.user!.branchId,
      userId: req.user!.id,
      action: AuditAction.UPDATE,
      entity: "ROLE",
      entityId: role.id,
      description: `Updated role ${role.name}${permissionIds ? ` (${permissionIds.length} permissions)` : ""}`,
    });
    res.json(updated);
  })
);

router.delete(
  "/roles/:id",
  requirePermission("role.delete"),
  asyncHandler(async (req, res) => {
    const role = await prisma.role.findUnique({ where: { id: req.params.id as string } });
    if (!role || role.companyId !== req.user!.companyId) throw ApiError.notFound("Role not found");
    if (role.isSystem) throw ApiError.badRequest("System roles cannot be deleted");
    await prisma.role.delete({ where: { id: role.id } });
    res.json({ success: true });
  })
);

// ===== USERS =====
router.get(
  "/",
  requirePermission("user.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const where: Record<string, unknown> = { companyId: req.user!.companyId };
    if (req.query.search as string) {
      where.OR = [
        { username: { contains: req.query.search as string, mode: "insensitive" as const } },
        { fullName: { contains: req.query.search as string, mode: "insensitive" as const } },
        { email: { contains: req.query.search as string, mode: "insensitive" as const } },
      ];
    }
    if (req.query.branchId as string) where.branchId = req.query.branchId as string;

    const [total, items] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          fullName: true,
          email: true,
          phone: true,
          branchId: true,
          isActive: true,
          mustChangePassword: true,
          lastLoginAt: true,
          failedLoginCount: true,
          lockedUntil: true,
          canViewAllBranches: true,
          createdAt: true,
          branch: { select: { code: true, name: true } },
          roles: { include: { role: { select: { id: true, name: true } } } },
          _count: { select: { loginHistory: true } },
        },
        orderBy: { fullName: "asc" },
        skip,
        take: pageSize,
      }),
    ]);
    res.json({ items, total, page, pageSize });
  })
);

router.post(
  "/",
  requirePermission("user.create"),
  validateBody(userCreateSchema),
  asyncHandler(async (req, res) => {
    const { roleIds, password, ...data } = req.body;

    // Validate branch
    if (data.branchId) {
      const branch = await prisma.branch.findUnique({ where: { id: data.branchId } });
      if (!branch || branch.companyId !== req.user!.companyId) throw ApiError.badRequest("Invalid branch");
    }

    // Validate roles
    if (roleIds && roleIds.length > 0) {
      const roles = await prisma.role.findMany({ where: { companyId: req.user!.companyId, id: { in: roleIds } } });
      if (roles.length !== roleIds.length) throw ApiError.badRequest("One or more roles are invalid");
    }

    const passwordHash = await bcrypt.hash(password ?? "Admin123!", env.bcryptRounds);
    const user = await prisma.user.create({
      data: {
        companyId: req.user!.companyId,
        ...data,
        passwordHash,
        ...(roleIds && roleIds.length > 0
          ? { roles: { create: roleIds.map((roleId: string) => ({ roleId })) } }
          : {}),
      },
    });

    const auditUserId = user.id;
    await writeAudit(prisma as any, {
      companyId: req.user!.companyId,
      branchId: data.branchId ?? req.user!.branchId,
      userId: req.user!.id,
      action: AuditAction.CREATE,
      entity: "USER",
      entityId: auditUserId,
      description: `Created user ${data.username}`,
    });
    res.status(201).json({ id: user.id, username: user.username, fullName: user.fullName });
  })
);

router.get(
  "/:id",
  requirePermission("user.view"),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id as string },
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        phone: true,
        branchId: true,
        companyId: true,
        isActive: true,
        mustChangePassword: true,
        canViewAllBranches: true,
        lastLoginAt: true,
        createdAt: true,
        branch: { select: { code: true, name: true } },
        roles: { include: { role: { select: { id: true, name: true } } } },
        employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true } },
      },
    });
    if (!user || user.companyId !== req.user!.companyId) throw ApiError.notFound("User not found");
    if (!req.user!.canViewAllBranches && user.branchId !== req.user!.branchId) throw ApiError.forbidden("You do not have access to this branch user");
    res.json(user);
  })
);

router.put(
  "/:id",
  requirePermission("user.edit"),
  validateBody(userUpdateSchema),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id as string } });
    if (!user || user.companyId !== req.user!.companyId) throw ApiError.notFound("User not found");
    if (!req.user!.canViewAllBranches && user.branchId !== req.user!.branchId) throw ApiError.forbidden("You do not have access to this branch user");

    const { roleIds, ...data } = req.body;
    const updated = await prisma.$transaction(async (tx) => {
      const userUpdate = await tx.user.update({
        where: { id: user.id },
        data,
      });
      if (roleIds) {
        await tx.userRole.deleteMany({ where: { userId: user.id } });
        if (roleIds.length > 0) {
          await tx.userRole.createMany({
            data: roleIds.map((roleId: string) => ({ userId: user.id, roleId })),
          });
        }
      }
      return userUpdate;
    });

    await writeAudit(prisma as any, {
      companyId: req.user!.companyId,
      branchId: req.user!.branchId,
      userId: req.user!.id,
      action: AuditAction.UPDATE,
      entity: "USER",
      entityId: user.id,
      description: `Updated user ${user.username}`,
    });
    res.json({ id: updated.id, username: updated.username });
  })
);

// Reset a user's password (admin)
router.post(
  "/:id/reset-password",
  requirePermission("user.edit"),
  validateBody(z.object({ newPassword: z.string().min(8) })),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id as string } });
    if (!user || user.companyId !== req.user!.companyId) throw ApiError.notFound("User not found");
    if (!req.user!.canViewAllBranches && user.branchId !== req.user!.branchId) throw ApiError.forbidden("You do not have access to this branch user");
    const passwordHash = await bcrypt.hash(req.body.newPassword, env.bcryptRounds);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: true, passwordChangedAt: new Date() },
    });
    await writeAudit(prisma as any, {
      companyId: req.user!.companyId,
      branchId: req.user!.branchId,
      userId: req.user!.id,
      action: AuditAction.UPDATE,
      entity: "USER_PASSWORD",
      entityId: user.id,
      description: `Admin reset password for ${user.username}`,
    });
    res.json({ success: true });
  })
);

// Deactivate user
router.delete(
  "/:id",
  requirePermission("user.delete"),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id as string } });
    if (!user || user.companyId !== req.user!.companyId) throw ApiError.notFound("User not found");
    if (!req.user!.canViewAllBranches && user.branchId !== req.user!.branchId) throw ApiError.forbidden("You do not have access to this branch user");
    if (user.id === req.user!.id) throw ApiError.badRequest("You cannot deactivate your own account");
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });
    await writeAudit(prisma as any, {
      companyId: req.user!.companyId,
      branchId: req.user!.branchId,
      userId: req.user!.id,
      action: AuditAction.DELETE,
      entity: "USER",
      entityId: user.id,
      description: `Deactivated user ${user.username}`,
    });
    res.json({ id: updated.id, isActive: updated.isActive });
  })
);

export default router;