import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { asyncHandler } from "../utils/handlers";
import { validateBody } from "../middleware/validate";
import { authenticate, signToken, loadUserPermissions } from "../middleware/auth";
import { env } from "../config";
import { writeAudit } from "../services/audit.service";
import { AuditAction } from "@prisma/client";

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

const resetRequestSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).regex(/[A-Z]/, "Password must contain an uppercase letter")
    .regex(/[a-z]/, "Password must contain a lowercase letter")
    .regex(/[0-9]/, "Password must contain a number"),
});

// POST /api/auth/login
router.post(
  "/login",
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    const user = await prisma.user.findUnique({
      where: { username },
      include: { roles: { include: { role: true } } },
    });

    const ip = req.ip ?? "unknown";

    if (!user) {
      await writeAudit(prisma as any, {
        companyId: "",
        branchId: null,
        userId: null,
        action: AuditAction.LOGIN_FAILED,
        entity: "AUTH",
        ip,
        description: `Failed login attempt for username '${username}'`,
      });
      throw ApiError.unauthorized("Invalid username or password");
    }

    if (!user.isActive) {
      throw ApiError.unauthorized("Account is deactivated. Contact your administrator.");
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw ApiError.unauthorized("Account is temporarily locked due to multiple failed attempts");
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      const failedCount = user.failedLoginCount + 1;
      const lockedUntil = failedCount >= 5 ? new Date(Date.now() + 15 * 60000) : null;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: failedCount, lockedUntil },
      });
      await writeAudit(prisma as any, {
        companyId: user.companyId,
        branchId: user.branchId,
        userId: user.id,
        action: AuditAction.LOGIN_FAILED,
        entity: "AUTH",
        ip,
        description: `Failed login for ${user.username} (attempt ${failedCount})`,
      });
      throw ApiError.unauthorized("Invalid username or password");
    }

    // Reset failed counter
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const authUser = await loadUserPermissions(user.id);
    if (!authUser) throw ApiError.unauthorized();

    const token = signToken(authUser);

    // Token hash for session tracking
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash,
        ip,
        userAgent: req.get("user-agent") ?? undefined,
        expiresAt: new Date(Date.now() + 12 * 3600000),
      },
    });

    await prisma.loginHistory.create({
      data: {
        userId: user.id,
        branchId: user.branchId,
        ip,
        userAgent: req.get("user-agent"),
        success: true,
      },
    });

    await writeAudit(prisma as any, {
      companyId: user.companyId,
      branchId: user.branchId,
      userId: user.id,
      action: AuditAction.LOGIN,
      entity: "AUTH",
      ip,
      description: `User ${user.username} logged in`,
    });

    res.json({
      token,
      user: {
        id: authUser.id,
        username: authUser.username,
        fullName: authUser.fullName,
        email: authUser.email,
        branchId: authUser.branchId,
        companyId: authUser.companyId,
        canViewAllBranches: authUser.canViewAllBranches,
        mustChangePassword: user.mustChangePassword,
        roles: authUser.roles,
        permissions: Array.from(authUser.permissions),
      },
    });
  })
);

// GET /api/auth/me
router.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await loadUserPermissions(req.user!.id);
    if (!user) throw ApiError.notFound("User not found");
    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    res.json({
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      branchId: user.branchId,
      companyId: user.companyId,
      canViewAllBranches: user.canViewAllBranches,
      mustChangePassword: dbUser?.mustChangePassword ?? false,
      roles: user.roles,
      permissions: Array.from(user.permissions),
    });
  })
);

// POST /api/auth/logout
router.post(
  "/logout",
  authenticate,
  asyncHandler(async (req, res) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    await prisma.session.updateMany({ where: { tokenHash }, data: { revokedAt: new Date(), isRevoked: true } });

    await writeAudit(prisma as any, {
      companyId: req.user!.companyId,
      branchId: req.user!.branchId,
      userId: req.user!.id,
      action: AuditAction.LOGOUT,
      entity: "AUTH",
      ip: req.ip,
      description: `User ${req.user!.username} logged out`,
    });

    res.json({ success: true });
  })
);

// POST /api/auth/change-password
router.post(
  "/change-password",
  authenticate,
  validateBody(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw ApiError.notFound("User not found");

    const valid = await bcrypt.compare(req.body.currentPassword, user.passwordHash);
    if (!valid) throw ApiError.badRequest("Current password is incorrect");

    const newHash = await bcrypt.hash(req.body.newPassword, env.bcryptRounds);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash, mustChangePassword: false, passwordChangedAt: new Date() },
    });

    await writeAudit(prisma as any, {
      companyId: user.companyId,
      branchId: req.user!.branchId,
      userId: user.id,
      action: AuditAction.UPDATE,
      entity: "USER_PASSWORD",
      entityId: user.id,
      ip: req.ip,
      description: "Password changed",
    });

    res.json({ success: true, message: "Password changed successfully" });
  })
);

// POST /api/auth/request-password-reset
router.post(
  "/request-password-reset",
  validateBody(resetRequestSchema),
  asyncHandler(async (req, res) => {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    // Always return success (do not leak user existence)
    if (user) {
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 60 * 60000),
        },
      });
      // In production, send via email/SMS provider. For now, log for dev.
      console.log(`[PASSWORD_RESET] user=${user.username} token=${token}`);
    }
    res.json({ success: true, message: "If the email exists, a reset link has been sent" });
  })
);

// POST /api/auth/reset-password
router.post(
  "/reset-password",
  validateBody(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    const tokenHash = crypto.createHash("sha256").update(req.body.token).digest("hex");
    const tokenDoc = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!tokenDoc || tokenDoc.usedAt || tokenDoc.expiresAt < new Date()) {
      throw ApiError.badRequest("Invalid or expired reset token");
    }
    const newHash = await bcrypt.hash(req.body.newPassword, env.bcryptRounds);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: tokenDoc.userId },
        data: { passwordHash: newHash, mustChangePassword: true, passwordChangedAt: new Date() },
      }),
      prisma.passwordResetToken.update({ where: { id: tokenDoc.id }, data: { usedAt: new Date() } }),
    ]);
    res.json({ success: true, message: "Password reset successfully. Please log in." });
  })
);

// GET /api/auth/login-history
router.get(
  "/login-history",
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.query.userId as string | undefined;
    const page = parseInt(req.query.page as string, 10) || 1;
    const pageSize = parseInt(req.query.pageSize as string, 10) || 25;

    const where = userId && (req.user!.canViewAllBranches || req.user!.permissions.has("user.view"))
      ? { userId }
      : { userId: req.user!.id };

    const [total, items] = await Promise.all([
      prisma.loginHistory.count({ where }),
      prisma.loginHistory.findMany({
        where,
        orderBy: { loginAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { username: true, fullName: true } } },
      }),
    ]);

    res.json({ items, total, page, pageSize });
  })
);

export default router;