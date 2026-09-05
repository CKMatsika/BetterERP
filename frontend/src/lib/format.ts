const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const qtyFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4, minimumFractionDigits: 0 });

export function fmtMoney(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? parseFloat(n) : (n ?? 0);
  if (Number.isNaN(v)) return "$0.00";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtPlain(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? parseFloat(n) : (n ?? 0);
  if (Number.isNaN(v)) return "0";
  return nf.format(v);
}

export function fmtQty(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? parseFloat(n) : (n ?? 0);
  if (Number.isNaN(v)) return "0";
  return qtyFmt.format(v);
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-ZW", { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return `${fmtDate(dt)} ${dt.toLocaleTimeString("en-ZW", { hour: "2-digit", minute: "2-digit" })}`;
}