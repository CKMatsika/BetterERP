import { Router } from "express";
import { z } from "zod";
import { Prisma, TransferStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { asyncHandler, parsePagination } from "../utils/handlers";
import { validateBody } from "../middleware/validate";
import { requirePermission } from "../middleware/auth";
import { writeAudit } from "../services/audit.service";
import { AuditAction } from "@prisma/client";
import { recordStockMovement } from "../services/inventory.service";
import { postJournal } from "../services/accounting.service";
import { getPostingAccounts } from "../services/postingAccounts.service";
import { nextReference } from "../services/sequence.service";
import { createApprovalRequest } from "../services/approval.service";
import { createNotification } from "../services/notification.service";
import { d, sub } from "../utils/money";

const router = Router();

const transferSchema = z.object({
  sourceBranchId: z.string(),
  sourceWarehouseId: z.string().optional(),
  destinationBranchId: z.string(),
  destinationWarehouseId: z.string().optional(),
  expectedAt: z.coerce.date().optional(),
  note: z.string().optional().nullable(),
  lines: z.array(z.object({
    productId: z.string(),
    requestedQty: z.coerce.number().positive(),
  })).min(1),
});

// GET /api/transfers
router.get(
  "/",
  requirePermission("transfer.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const where: Prisma.StockTransferWhereInput = { companyId: req.user!.companyId };

    if (!req.user!.canViewAllBranches) {
      where.OR = [{ sourceBranchId: req.user!.branchId ?? "" }, { destinationBranchId: req.user!.branchId ?? "" }];
    }
    if (req.query.status as string) where.status = req.query.status as any;
    if (req.query.search as string) where.reference = { contains: req.query.search as string, mode: "insensitive" };

    const [total, items] = await Promise.all([
      prisma.stockTransfer.count({ where }),
      prisma.stockTransfer.findMany({
        where,
        include: {
          sourceBranch: { select: { id: true, name: true, code: true } },
          destinationBranch: { select: { id: true, name: true, code: true } },
          lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
        },
        orderBy: { requestedAt: "desc" },
        skip,
        take: pageSize,
      }),
    ]);
    res.json({ items, total, page, pageSize });
  })
);

// GET /api/transfers/outstanding
router.get(
  "/outstanding",
  requirePermission("transfer.view"),
  asyncHandler(async (req, res) => {
    const where: Prisma.StockTransferWhereInput = {
      companyId: req.user!.companyId,
      status: { in: ["REQUESTED", "PENDING_APPROVAL", "APPROVED", "DISPATCHED", "IN_TRANSIT", "PARTIAL_RECEIVED"] as TransferStatus[] },
    };
    if (!req.user!.canViewAllBranches) {
      where.OR = [{ sourceBranchId: req.user!.branchId ?? "" }, { destinationBranchId: req.user!.branchId ?? "" }];
    }
    const items = await prisma.stockTransfer.findMany({
      where,
      include: {
        sourceBranch: { select: { id: true, name: true, code: true } },
        destinationBranch: { select: { id: true, name: true, code: true } },
        lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
      },
      orderBy: { requestedAt: "desc" },
    });
    res.json({ items });
  })
);

// POST /api/transfers — create transfer request
router.post(
  "/",
  requirePermission("transfer.create"),
  validateBody(transferSchema),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    if (req.body.sourceBranchId === req.body.destinationBranchId) {
      throw ApiError.badRequest("Source and destination branches must differ");
    }
    return prisma.$transaction(async (tx) => {
      const src = await tx.branch.findUnique({ where: { id: req.body.sourceBranchId } });
      const dst = await tx.branch.findUnique({ where: { id: req.body.destinationBranchId } });
      if (!src || !dst || src.companyId !== companyId || dst.companyId !== companyId) {
        throw ApiError.notFound("Branch not found");
      }

      // Verify stock availability at source
      const lines: any[] = [];
      for (const l of req.body.lines) {
        const product = await tx.product.findUnique({ where: { id: l.productId } });
        if (!product || product.companyId !== companyId) throw ApiError.badRequest("Invalid product");
        const stock = await tx.stockBalance.aggregate({
          where: { productId: l.productId, warehouse: { branchId: req.body.sourceBranchId } },
          _sum: { available: true },
        });
        const available = d(stock._sum.available ?? 0);
        if (d(l.requestedQty).greaterThan(available)) {
          throw ApiError.badRequest(`Insufficient stock at ${src.name} for ${product.name} (${product.sku}). Available: ${available}`);
        }
        lines.push({ productId: l.productId, requestedQty: d(l.requestedQty), unitCost: product.averageCost });
      }

      const reference = await nextReference({ companyId, branchId: req.body.sourceBranchId, docType: "TRANSFER" });

      const transfer = await tx.stockTransfer.create({
        data: {
          companyId,
          reference,
          sourceBranchId: req.body.sourceBranchId,
          sourceWarehouseId: req.body.sourceWarehouseId,
          destinationBranchId: req.body.destinationBranchId,
          destinationWarehouseId: req.body.destinationWarehouseId,
          status: "REQUESTED",
          requestedById: req.user!.id,
          expectedAt: req.body.expectedAt,
          note: req.body.note,
          lines: { create: lines },
        },
      });

      const approvalId = await createApprovalRequest(tx as any, {
        companyId,
        branchId: req.body.sourceBranchId,
        entityType: "BRANCH_TRANSFER",
        entityId: transfer.id,
        entityRef: reference,
        requestedById: req.user!.id,
        workflowType: "BRANCH_TRANSFER",
      });

      await createNotification(tx as any, {
        companyId,
        branchId: req.body.sourceBranchId,
        type: "TRANSFER_PENDING",
        title: `Stock transfer ${reference} awaiting approval`,
        message: `Transfer ${reference} from ${src.name} to ${dst.name} requires approval`,
        entityType: "STOCK_TRANSFER",
        entityId: transfer.id,
        priority: "HIGH",
      });

      await writeAudit(tx as any, {
        companyId,
        branchId: req.body.sourceBranchId,
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entity: "STOCK_TRANSFER",
        entityId: transfer.id,
        afterJson: { reference, approvalId },
        description: `Transfer request ${reference}`,
      });
      return { transfer, approvalId };
    }).then((r) => res.status(201).json(r));
  })
);

// POST /api/transfers/:id/approve
router.post(
  "/:id/approve",
  requirePermission("transfer.approve"),
  validateBody(z.object({ comments: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const transfer = await prisma.stockTransfer.findUnique({ where: { id: req.params.id as string } });
    if (!transfer || transfer.companyId !== req.user!.companyId) throw ApiError.notFound("Transfer not found");
    if (transfer.status !== "REQUESTED" && transfer.status !== "PENDING_APPROVAL") {
      throw ApiError.badRequest("Transfer cannot be approved from current status");
    }
    await prisma.$transaction(async (tx) => {
      await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: { status: "APPROVED", approvedById: req.user!.id, approvedAt: new Date() },
      });
      await writeAudit(tx as any, {
        companyId: req.user!.companyId,
        branchId: transfer.sourceBranchId,
        userId: req.user!.id,
        action: AuditAction.APPROVE,
        entity: "STOCK_TRANSFER",
        entityId: transfer.id,
        description: `Approved transfer ${transfer.reference}`,
      });
    });
    res.json({ success: true, status: "APPROVED" });
  })
);

// POST /api/transfers/:id/dispatch
router.post(
  "/:id/dispatch",
  requirePermission("transfer.dispatch"),
  asyncHandler(async (req, res) => {
    const transfer = await prisma.stockTransfer.findUnique({
      where: { id: req.params.id as string },
      include: { lines: true },
    });
    if (!transfer || transfer.companyId !== req.user!.companyId) throw ApiError.notFound("Transfer not found");
    if (!["APPROVED", "PARTIAL_RECEIVED"].includes(transfer.status)) {
      throw ApiError.badRequest("Only approved transfers can be dispatched");
    }
    if (!req.user!.canViewAllBranches && transfer.sourceBranchId !== req.user!.branchId) {
      throw ApiError.forbidden("You can only dispatch transfers from your branch");
    }

    return prisma.$transaction(async (tx) => {
      for (const line of transfer.lines) {
        if (!line.productId) throw ApiError.badRequest("Transfer line must reference a product");
        const movement = await recordStockMovement(tx as any, {
          companyId: req.user!.companyId,
          branchId: transfer.sourceBranchId,
          warehouseId: transfer.sourceWarehouseId,
          productId: line.productId,
          type: "BRANCH_TRANSFER_OUT",
          quantity: line.requestedQty.neg(),
          unitCost: line.unitCost,
          reference: transfer.reference,
          sourceType: "STOCK_TRANSFER",
          sourceId: transfer.id,
          userId: req.user!.id,
          note: `Dispatched to ${transfer.destinationBranchId}`,
        });
        await tx.stockTransferLine.update({
          where: { id: line.id },
          data: { dispatchedQty: line.requestedQty, unitCost: movement.newAverageCost },
        });

        // Record in-transit stock at destination branch warehouse
        await recordStockMovement(tx as any, {
          companyId: req.user!.companyId,
          branchId: transfer.destinationBranchId,
          warehouseId: transfer.sourceWarehouseId,
          productId: line.productId,
          type: "TRANSFER_IN_TRANSIT",
          quantity: line.requestedQty,
          unitCost: movement.newAverageCost,
          reference: transfer.reference,
          sourceType: "STOCK_TRANSFER",
          sourceId: transfer.id,
          userId: req.user!.id,
          note: "In transit",
        });
      }

      const postingAccounts = await getPostingAccounts(tx as any, req.user!.companyId, transfer.destinationBranchId);
      // GL: no revenue recognized; stock moved to in-transit
      const totalCost = transfer.lines.reduce((acc, l) => acc.plus(d(l.requestedQty).mul(d(l.unitCost ?? 0))), d(0));
      await postJournal(tx as any, {
        companyId: req.user!.companyId,
        branchId: transfer.destinationBranchId,
        reference: `TRF-${transfer.reference}`,
        description: `Dispatch transfer ${transfer.reference}`,
        entryType: "TRANSFER",
        sourceType: "STOCK_TRANSFER",
        sourceId: transfer.id,
        userId: req.user!.id,
        skipReference: true,
        lines: [
          { accountId: postingAccounts.inventoryInTransitId, debit: totalCost, description: `In transit ${transfer.reference}` },
          { accountId: postingAccounts.inventoryId, credit: totalCost, description: `Dispatch ${transfer.reference}` },
        ],
      });

      await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: { status: "IN_TRANSIT", dispatchedById: req.user!.id, dispatchedAt: new Date() },
      });

      await createNotification(tx as any, {
        companyId: req.user!.companyId,
        branchId: transfer.destinationBranchId,
        type: "TRANSFER_DISPATCHED",
        title: `Transfer ${transfer.reference} dispatched`,
        message: `Stock en route to your branch (${transfer.reference})`,
        entityType: "STOCK_TRANSFER",
        entityId: transfer.id,
      });

      await writeAudit(tx as any, {
        companyId: req.user!.companyId,
        branchId: transfer.sourceBranchId,
        userId: req.user!.id,
        action: AuditAction.POST,
        entity: "STOCK_TRANSFER",
        entityId: transfer.id,
        afterJson: { status: "IN_TRANSIT" },
        description: `Dispatched transfer ${transfer.reference}`,
      });
      return { success: true, status: "IN_TRANSIT" };
    }).then((r) => res.json(r));
  })
);

// POST /api/transfers/:id/receive
router.post(
  "/:id/receive",
  requirePermission("transfer.receive"),
  validateBody(z.object({
    lines: z.array(z.object({
      lineId: z.string(),
      receivedQty: z.coerce.number().nonnegative(),
      damagedQty: z.coerce.number().nonnegative().default(0),
      locationId: z.string().optional().nullable(),
    })).min(1),
  })),
  asyncHandler(async (req, res) => {
    const transfer = await prisma.stockTransfer.findUnique({
      where: { id: req.params.id as string },
      include: { lines: true },
    });
    if (!transfer || transfer.companyId !== req.user!.companyId) throw ApiError.notFound("Transfer not found");
    if (!["IN_TRANSIT", "PARTIAL_RECEIVED"].includes(transfer.status)) {
      throw ApiError.badRequest("Transfer is not in transit");
    }
    if (!req.user!.canViewAllBranches && transfer.destinationBranchId !== req.user!.branchId) {
      throw ApiError.forbidden("You can only receive transfers at your branch");
    }

    return prisma.$transaction(async (tx) => {
      let allFullyReceived = true;
      let totalDamaged = d(0);
      const postingAccounts = await getPostingAccounts(tx as any, req.user!.companyId, transfer.destinationBranchId);
      const journalLines: any[] = [];

      for (const reqLine of req.body.lines) {
        const line = transfer.lines.find((l) => l.id === reqLine.lineId);
        if (!line) throw ApiError.badRequest("Invalid transfer line");
        if (!line.productId) throw ApiError.badRequest("Transfer line must reference a product");

        const receivedQty = d(reqLine.receivedQty);
        const damagedQty = d(reqLine.damagedQty ?? 0);
        totalDamaged = totalDamaged.plus(damagedQty);

        // Reduce in-transit
        const inTransit = d(line.dispatchedQty).minus(d(line.receivedQty));
        const toReceiveReceived = receivedQty;
        if (toReceiveReceived.isPositive()) {
          await recordStockMovement(tx as any, {
            companyId: req.user!.companyId,
            branchId: transfer.destinationBranchId,
            warehouseId: transfer.destinationWarehouseId ?? undefined,
            locationId: reqLine.locationId,
            productId: line.productId,
            type: "BRANCH_TRANSFER_RECEIVE",
            quantity: toReceiveReceived,
            unitCost: line.unitCost,
            reference: transfer.reference,
            sourceType: "STOCK_TRANSFER",
            sourceId: transfer.id,
            userId: req.user!.id,
            note: "Transfer received",
          });
        }

        const movedQty = toReceiveReceived.plus(damagedQty);
        if (movedQty.isPositive()) {
          await recordStockMovement(tx as any, {
            companyId: req.user!.companyId,
            branchId: transfer.destinationBranchId,
            warehouseId: transfer.sourceWarehouseId,
            productId: line.productId,
            type: "BRANCH_TRANSFER_IN",
            quantity: movedQty.neg(),
            unitCost: line.unitCost,
            reference: transfer.reference,
            sourceType: "STOCK_TRANSFER",
            sourceId: transfer.id,
            userId: req.user!.id,
            note: "Clear in-transit",
          });
        }

        // Damaged goods -> write-off
        if (damagedQty.isPositive()) {
          await recordStockMovement(tx as any, {
            companyId: req.user!.companyId,
            branchId: transfer.destinationBranchId,
            warehouseId: transfer.destinationWarehouseId ?? undefined,
            productId: line.productId,
            type: "DAMAGE",
            quantity: damagedQty.neg(),
            unitCost: line.unitCost,
            reference: transfer.reference,
            sourceType: "STOCK_TRANSFER",
            sourceId: transfer.id,
            userId: req.user!.id,
            note: "Damaged in transit",
          });
          journalLines.push({
            accountId: postingAccounts.stockWriteoffId,
            debit: damagedQty.mul(d(line.unitCost ?? 0)),
            description: `Damaged in transit ${line.productId}`,
          });
        }

        const newReceived = d(line.receivedQty).plus(receivedQty);
        await tx.stockTransferLine.update({
          where: { id: line.id },
          data: { receivedQty: newReceived, damagedQty: damagedQty },
        });

        if (newReceived.lessThan(d(line.dispatchedQty).minus(damagedQty))) {
          allFullyReceived = false;
        }
      }

      // Clear in-transit balance to avoid double counting
      const stockValue = transfer.lines.reduce(
        (acc, l) => acc.plus(d(l.requestedQty).mul(d(l.unitCost ?? 0))),
        d(0)
      );
      journalLines.push({
        accountId: postingAccounts.inventoryId,
        debit: sub(stockValue, totalDamaged.mul(d(1))).toDecimalPlaces(4).isNaN() ? d(0) : stockValue.minus(totalDamaged.mul(d(1))),
        description: `Transfer received ${transfer.reference}`,
      });
      journalLines.push({
        accountId: postingAccounts.inventoryInTransitId,
        credit: stockValue,
        description: `Transfer received ${transfer.reference}`,
      });

      await postJournal(tx as any, {
        companyId: req.user!.companyId,
        branchId: transfer.destinationBranchId,
        reference: `TRF-${transfer.reference}`,
        description: `Receive transfer ${transfer.reference}`,
        entryType: "TRANSFER",
        sourceType: "STOCK_TRANSFER",
        sourceId: transfer.id,
        userId: req.user!.id,
        skipReference: true,
        lines: journalLines,
      });

      await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: {
          status: allFullyReceived ? "RECEIVED" : "PARTIAL_RECEIVED",
          receivedById: req.user!.id,
          receivedAt: new Date(),
        },
      });

      await createNotification(tx as any, {
        companyId: req.user!.companyId,
        branchId: transfer.sourceBranchId,
        type: "TRANSFER_RECEIVED",
        title: `Transfer ${transfer.reference} received`,
        message: `Stock received at destination branch`,
        entityType: "STOCK_TRANSFER",
        entityId: transfer.id,
      });

      await writeAudit(tx as any, {
        companyId: req.user!.companyId,
        branchId: transfer.destinationBranchId,
        userId: req.user!.id,
        action: AuditAction.POST,
        entity: "STOCK_TRANSFER",
        entityId: transfer.id,
        afterJson: { status: allFullyReceived ? "RECEIVED" : "PARTIAL_RECEIVED" },
        description: `Received transfer ${transfer.reference}`,
      });

      return { success: true, status: allFullyReceived ? "RECEIVED" : "PARTIAL_RECEIVED" };
    }).then((r) => res.json(r));
  })
);

// POST /api/transfers/:id/cancel
router.post(
  "/:id/cancel",
  requirePermission("transfer.cancel"),
  validateBody(z.object({ reason: z.string().min(3) })),
  asyncHandler(async (req, res) => {
    const transfer = await prisma.stockTransfer.findUnique({ where: { id: req.params.id as string } });
    if (!transfer || transfer.companyId !== req.user!.companyId) throw ApiError.notFound("Transfer not found");
    if (["RECEIVED", "CANCELLED"].includes(transfer.status)) throw ApiError.badRequest("Transfer cannot be cancelled");
    await prisma.stockTransfer.update({
      where: { id: transfer.id },
      data: { status: "CANCELLED" },
    });
    res.json({ success: true, status: "CANCELLED" });
  })
);

// GET /api/transfers/:id
router.get(
  "/:id",
  requirePermission("transfer.view"),
  asyncHandler(async (req, res) => {
    const transfer = await prisma.stockTransfer.findUnique({
      where: { id: req.params.id as string },
      include: {
        sourceBranch: true,
        destinationBranch: true,
        lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
      },
    });
    if (!transfer || transfer.companyId !== req.user!.companyId) throw ApiError.notFound("Transfer not found");
    res.json(transfer);
  })
);

export default router;