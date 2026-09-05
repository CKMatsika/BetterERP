import { Prisma } from "@prisma/client";

export type Decimal = Prisma.Decimal;

export function d(value: string | number | Decimal): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value;
  return new Prisma.Decimal(value);
}

export function add(a: string | number | Decimal, b: string | number | Decimal): Prisma.Decimal {
  return d(a).plus(d(b));
}

export function sub(a: string | number | Decimal, b: string | number | Decimal): Prisma.Decimal {
  return d(a).minus(d(b));
}

export function mul(a: string | number | Decimal, b: string | number | Decimal): Prisma.Decimal {
  return d(a).mul(d(b));
}

export function div(a: string | number | Decimal, b: string | number | Decimal): Prisma.Decimal {
  return d(a).div(d(b));
}

export function isZero(a: string | number | Decimal): boolean {
  return d(a).isZero();
}

export function sum(values: Array<string | number | Decimal>): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((acc, v) => acc.plus(d(v)), new Prisma.Decimal(0));
}

export function abs(a: string | number | Decimal): Prisma.Decimal {
  return d(a).abs();
}

export function max(a: string | number | Decimal, b: string | number | Decimal): Prisma.Decimal {
  return Prisma.Decimal.max(d(a), d(b));
}

export function money(a: string | number | Decimal): Prisma.Decimal {
  return d(a).toDecimalPlaces(2);
}

export function fmt(a: string | number | Decimal): string {
  return d(a).toFixed(4);
}