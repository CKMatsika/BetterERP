import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { asyncHandler, parsePagination } from "../utils/handlers";
import { validateBody } from "../middleware/validate";
import { requirePermission } from "../middleware/auth";
import { writeAudit } from "../services/audit.service";
import { AuditAction } from "@prisma/client";
import { env } from "../config";

const router = Router();

// Allowed MIME types for uploads
const ALLOWED_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["application/pdf", ".pdf"],
  ["text/csv", ".csv"],
  ["application/vnd.ms-excel", ".xls"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"],
  ["application/msword", ".doc"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"],
  ["text/plain", ".txt"],
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Config storage directory
fs.mkdirSync(env.fileUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, env.fileUploadDir);
  },
  filename: (_req, file, cb) => {
    const random = crypto.randomBytes(16).toString("hex");
    const ext = ALLOWED_TYPES.get(file.mimetype) ?? path.extname(file.originalname);
    cb(null, `${Date.now()}-${random}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.has(file.mimetype)) return cb(null, true);
    cb(new Error("Unsupported file type"));
  },
});

// Upload a file
router.post(
  "/upload",
  requirePermission("system.manage"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest("No system.manageed");

    const companyId = req.user!.companyId;
    const entityType = (req.body.entityType as string) ?? "GENERAL";
    const entityId = (req.body.entityId as string) ?? "";

    const attachment = await prisma.attachment.create({
      data: {
        companyId,
        entityType,
        entityId,
        fileName: req.body.fileName ?? req.file.originalname,
        filePath: req.file.filename,
        mimeType: req.file.mimetype,
        size: req.file.size,
        uploadedById: req.user!.id,
      },
    });

    await writeAudit(prisma as any, {
      companyId,
      userId: req.user!.id,
      action: AuditAction.CREATE,
      entity: "ATTACHMENT",
      entityId: attachment.id,
      afterJson: { fileName: attachment.fileName },
    });

    res.status(201).json({ id: attachment.id, fileName: attachment.fileName });
  })
);

// List attachments for an entity
router.get(
  "/",
  requirePermission("system.manage"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const where: Prisma.AttachmentWhereInput = { companyId: req.user!.companyId };
    if (req.query.entityType as string) where.entityType = req.query.entityType as string;
    if (req.query.entityId as string) where.entityId = req.query.entityId as string;

    const [total, items] = await Promise.all([
      prisma.attachment.count({ where }),
      prisma.attachment.findMany({ where, orderBy: { uploadedAt: "desc" }, skip, take: pageSize }),
    ]);
    res.json({ items, total, page, pageSize });
  })
);

// Download/serve a private file (secure - requires auth)
router.get(
  "/download/:id",
  requirePermission("system.manage"),
  asyncHandler(async (req, res) => {
    const attachment = await prisma.attachment.findUnique({ where: { id: req.params.id as string } });
    if (!attachment || attachment.companyId !== req.user!.companyId) throw ApiError.notFound("File not found");

    const filePath = path.resolve(env.fileUploadDir, attachment.filePath);
    if (!fs.existsSync(filePath)) throw ApiError.notFound("File no longer exists");

    // Resolve the absolute path is within the upload dir
    const uploadRoot = path.resolve(env.fileUploadDir);
    if (!filePath.startsWith(uploadRoot)) throw ApiError.forbidden("Invalid file path");

    res.setHeader("Content-Type", attachment.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${attachment.fileName}"`);
    fs.createReadStream(filePath).pipe(res);
  })
);

// Delete a file
router.delete(
  "/:id",
  requirePermission("system.manage"),
  asyncHandler(async (req, res) => {
    const attachment = await prisma.attachment.findUnique({ where: { id: req.params.id as string } });
    if (!attachment || attachment.companyId !== req.user!.companyId) throw ApiError.notFound("File not found");
    const filePath = path.resolve(env.fileUploadDir, attachment.filePath);
    await prisma.attachment.delete({ where: { id: attachment.id } });
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // ignore
      }
    }
    res.json({ success: true });
  })
);

// Update attachment metadata
router.put(
  "/:id",
  requirePermission("system.manage"),
  validateBody(z.object({ fileName: z.string().optional(), entityType: z.string().optional(), entityId: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const attachment = await prisma.attachment.findUnique({ where: { id: req.params.id as string } });
    if (!attachment || attachment.companyId !== req.user!.companyId) throw ApiError.notFound("File not found");
    const updated = await prisma.attachment.update({ where: { id: attachment.id }, data: req.body });
    res.json(updated);
  })
);

export default router;
