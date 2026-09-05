import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { env } from "../config";

export interface AuthUser {
  id: string;
  companyId: string;
  branchId: string | null;
  username: string;
  fullName: string;
  email: string | null;
  canViewAllBranches: boolean;
  isActive: boolean;
  roles: string[];
  permissions: Set<string>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export interface JwtPayload {
  sub: string;
  companyId: string;
  branchId: string | null;
  roles: string[];
  permissions: string[];
  canViewAllBranches: boolean;
}

export async function loadUserPermissions(userId: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      roles: {
        include: {
          role: {
            include: {
              permissions: { include: { permission: true } },
            },
          },
        },
      },
    },
  });
  if (!user) return null;

  const roles = user.roles.map((r) => r.role.name);
  const permissions = new Set<string>();
  for (const ur of user.roles) {
    for (const rp of ur.role.permissions) {
      permissions.add(rp.permission.code);
    }
  }

  return {
    id: user.id,
    companyId: user.companyId,
    branchId: user.branchId,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    canViewAllBranches: user.canViewAllBranches,
    isActive: user.isActive,
    roles,
    permissions,
  };
}

export async function verifyToken(token: string): Promise<JwtPayload> {
  return jwt.verify(token, env.jwtSecret) as JwtPayload;
}

export function signToken(user: AuthUser): string {
  const payload: JwtPayload = {
    sub: user.id,
    companyId: user.companyId,
    branchId: user.branchId,
    roles: user.roles,
    permissions: Array.from(user.permissions),
    canViewAllBranches: user.canViewAllBranches,
  };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"] });
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      throw ApiError.unauthorized("Authentication required");
    }
    const token = header.slice(7);
    const payload = await verifyToken(token);
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const session = await prisma.session.findUnique({ where: { tokenHash } });
    if (!session || session.isRevoked || session.expiresAt <= new Date() || session.userId !== payload.sub) {
      throw ApiError.unauthorized("Session is no longer valid");
    }
    const user = await loadUserPermissions(payload.sub);
    if (!user) {
      throw ApiError.unauthorized("User no longer exists");
    }
    if (!user.isActive) {
      throw ApiError.unauthorized("User account is deactivated");
    }
    if (payload.companyId !== user.companyId) {
      throw ApiError.unauthorized("Invalid token");
    }
    req.user = user;
    next();
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      next(ApiError.unauthorized("Invalid or expired token"));
    } else {
      next(err);
    }
  }
}

export function requirePermission(permissionCode: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(ApiError.unauthorized());
    }
    if (!req.user.permissions.has(permissionCode)) {
      return next(ApiError.forbidden(`Missing permission: ${permissionCode}`));
    }
    next();
  };
}

// Branch isolation: restrict to the user's branch unless they can view all branches
export function enforceBranchScope(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(ApiError.unauthorized());
  const targetBranchId = (req.query.branchId as string) || (req.body?.branchId as string) || (req.params.branchId as string);
  if (targetBranchId) {
    if (req.user.canViewAllBranches) return next();
    if (req.user.branchId && targetBranchId === req.user.branchId) return next();
    if (!req.user.permissions.has("branch.view_other_branches")) {
      return next(ApiError.forbidden("You do not have access to this branch's data"));
    }
  }
  next();
}

// Branch ID for the current context: user's branch or the requested branch
export function effectiveBranchId(req: Request): string | null {
  if (!req.user) return null;
  const requested = (req.query.branchId as string) || (req.body?.branchId as string) || (req.params.branchId as string);
  if (requested && (req.user.canViewAllBranches || req.user.permissions.has("branch.view_other_branches"))) {
    return requested;
  }
  return req.user.branchId;
}

export function branchMatchesUser(req: Request, branchId: string | null | undefined): boolean {
  if (!req.user) return false;
  if (req.user.canViewAllBranches) return true;
  if (!branchId) return true;
  return branchId === req.user.branchId;
}