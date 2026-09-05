import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { asyncHandler, parsePagination } from "../utils/handlers";
import { requirePermission } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { z } from "zod";

const router = Router();

router.get(
  "/",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const companyId = req.user!.companyId;
    const userId = req.user!.id;

    const where: Prisma.UserNotificationWhereInput = { userId };
    if (req.query.status as string === "unread") where.readAt = null;
    if (req.query.status as string === "read") where.readAt = { not: null };

    const [total, userNotifications] = await Promise.all([
      prisma.userNotification.count({ where }),
      prisma.userNotification.findMany({
        where,
        include: { notification: true },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
    ]);

    const unreadCount = await prisma.userNotification.count({
      where: { userId, readAt: null },
    });

    res.json({
      items: userNotifications.map((un) => un.notification),
      total,
      page,
      pageSize,
      unreadCount,
    });
  })
);

// Mark a notification as read
router.post(
  "/:id/read",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    const userNotification = await prisma.userNotification.findUnique({
      where: { userId_notificationId: { userId: req.user!.id, notificationId: req.params.id as string } },
    });
    if (!userNotification) throw ApiError.notFound("Notification not found");
    await prisma.userNotification.update({
      where: { userId_notificationId: { userId: req.user!.id, notificationId: req.params.id as string } },
      data: { readAt: new Date() },
    });
    res.json({ success: true });
  })
);

// Mark all as read
router.post(
  "/read-all",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    await prisma.userNotification.updateMany({
      where: { userId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ success: true });
  })
);

// Mark as archived
router.post(
  "/:id/archive",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const un = await prisma.userNotification.findUnique({
      where: { userId_notificationId: { userId: req.user!.id, notificationId: id } },
    });
    if (!un) throw ApiError.notFound("Notification not found");
    await prisma.notification.update({
      where: { id },
      data: { status: "ARCHIVED" },
    });
    res.json({ success: true });
  })
);

// Get unread count for badge
router.get(
  "/unread-count",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    const count = await prisma.userNotification.count({
      where: { userId: req.user!.id, readAt: null },
    });
    res.json({ count });
  })
);

export default router;