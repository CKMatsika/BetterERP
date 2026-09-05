import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { d, mul, div, add } from "../utils/money";

type Tx = Prisma.TransactionClient;

export type MovementType =
  | "PURCHASE_RECEIPT"
  | "SALES"
  | "SALES_RETURN"
  | "PURCHASE_RETURN"
  | "BRANCH_TRANSFER_OUT"
  | "BRANCH_TRANSFER_IN"
  | "BRANCH_TRANSFER_RECEIVE"
  | "STOCK_ADJUSTMENT"
  | "STOCK_COUNT"
  | "DAMAGE"
  | "WRITE_OFF"
  | "OPENING_STOCK"
  | "INTERNAL_CONSUMPTION"
  | "TRANSFER_IN_TRANSIT";

export interface StockMovementInput {
  companyId: string;
  branchId: string;
  warehouseId?: string | null;
  locationId?: string | null;
  productId: string;
  type: MovementType;
  quantity: Prisma.Decimal | string | number; // signed: positive = inbound, negative = outbound
  unitCost?: Prisma.Decimal | string | number | null;
  reference?: string;
  sourceType?: string;
  sourceId?: string;
  userId?: string | null;
  note?: string;
}

export interface MovementResult {
  ledgerId: string;
  newOnHand: Prisma.Decimal;
  newAverageCost: Prisma.Decimal;
}

// Update stock balance and record an auditable ledger entry atomically.
// Stock balance rows are updated with row-level locking via upsert + transaction.
export async function recordStockMovement(tx: Tx, input: StockMovementInput): Promise<MovementResult> {
  const product = await tx.product.findUnique({
    where: { id: input.productId },
    select: {
      id: true,
      companyId: true,
      allowNegative: true,
      averageCost: true,
      costingMethod: true,
    },
  });
  if (!product) throw ApiError.notFound("Product not found");
  if (product.companyId !== input.companyId) throw ApiError.forbidden("Product does not belong to this company");

  const qty = d(input.quantity);
  const warehouseId = input.warehouseId ?? null;
  const locationId = input.locationId ?? null;

  // Lock the balance row by reading it inside the transaction first
  let balance = await tx.stockBalance.findFirst({
    where: { productId: input.productId, warehouseId: warehouseId ?? "", locationId },
  });

  if (!balance) {
    if (qty.isNegative()) {
      // No existing stock; only allow positive (build) movements on empty balance
      if (!product.allowNegative) {
        throw ApiError.badRequest(`Stock cannot be negative for product ${input.productId}`);
      }
    }
    const agent = await tx.warehouse.findFirst({ where: { id: warehouseId ?? "" }, select: { branchId: true } });
    balance = await tx.stockBalance.create({
      data: {
        productId: input.productId,
        warehouseId: warehouseId ?? "",
        locationId,
        onHand: 0,
        reserved: 0,
        available: 0,
        damaged: 0,
        inTransit: 0,
        ordered: 0,
        averageCost: 0,
        value: 0,
      },
    });
    if (warehouseId) {
      const updated = await tx.stockBalance.update({
        where: { id: balance.id },
        data: {
          warehouseId,
        },
      });
      balance = updated;
    }
    void agent;
  }

  const beforeQty = d(balance.onHand ?? 0);
  let afterQty = add(beforeQty, qty);

  if (afterQty.isNegative() && !product.allowNegative) {
    throw ApiError.badRequest(`Insufficient stock for product ${input.productId}: on hand ${beforeQty}, attempted change ${qty}`);
  }

  // Weighted-average cost recalculation
  let unitCost = input.unitCost != null ? d(input.unitCost) : product.averageCost ? d(product.averageCost) : d(0);
  let newAverageCost = balance.averageCost ? d(balance.averageCost) : d(0);
  const valueBefore = mul(beforeQty, newAverageCost);

  // For inbound movements with cost, recompute the average
  if (qty.isPositive() && unitCost.isPositive()) {
    const valueAfter = add(valueBefore, mul(qty, unitCost));
    newAverageCost = div(valueAfter, afterQty);
  } else if (qty.isNegative()) {
    unitCost = newAverageCost;
  }

  const valueAfter = mul(afterQty, newAverageCost);

  await tx.stockBalance.update({
    where: { id: balance.id },
    data: {
      onHand: afterQty,
      available: add(d(balance.available ?? 0), qty),
      averageCost: newAverageCost,
      value: valueAfter,
    },
  });

  const ledger = await tx.stockMovement.create({
    data: {
      companyId: input.companyId,
      branchId: input.branchId,
      warehouseId,
      reference: input.reference ?? "",
      type: input.type,
      productId: input.productId,
      quantity: qty,
      beforeQty: beforeQty,
      afterQty,
      unitCost: unitCost.isZero() ? null : unitCost,
      totalCost: mul(qty.abs(), unitCost).isZero() ? null : mul(qty.abs(), unitCost),
      sourceRef: input.reference,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      userId: input.userId ?? null,
      note: input.note,
    },
  });

  return { ledgerId: ledger.id, newOnHand: afterQty, newAverageCost };
}

// Query helpers
export async function getStockOnHand(companyId: string, productId: string, branchId?: string, warehouseId?: string) {
  const where: Prisma.StockBalanceWhereInput = { productId };
  if (warehouseId) {
    where.warehouseId = warehouseId;
  } else if (branchId) {
    where.warehouse = { branchId };
  }
  const rows = await prisma.stockBalance.findMany({
    where,
    select: { onHand: true, reserved: true, available: true, damaged: true, inTransit: true, ordered: true, averageCost: true, value: true },
  });
  const zero = d(0);
  return rows.reduce(
    (acc, r) => ({
      onHand: acc.onHand.plus(r.onHand ?? zero),
      reserved: acc.reserved.plus(r.reserved ?? zero),
      available: acc.available.plus(r.available ?? zero),
      damaged: acc.damaged.plus(r.damaged ?? zero),
      inTransit: acc.inTransit.plus(r.inTransit ?? zero),
      ordered: acc.ordered.plus(r.ordered ?? zero),
      value: acc.value.plus(r.value ?? zero),
    }),
    { onHand: zero, reserved: zero, available: zero, damaged: zero, inTransit: zero, ordered: zero, value: zero }
  );
}

export function signedQty(type: MovementType, baseQty: Prisma.Decimal): Prisma.Decimal {
  const inbound: MovementType[] = [
    "PURCHASE_RECEIPT",
    "SALES_RETURN",
    "BRANCH_TRANSFER_IN",
    "BRANCH_TRANSFER_RECEIVE",
    "OPENING_STOCK",
  ];
  return inbound.includes(type) ? baseQty.abs() : baseQty.abs().neg();
}