import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { Button, Card, Input, Spinner, EmptyState } from "../components/ui";

const REPORTS: Array<{ group: string; name: string; path: string }> = [
  { group: "Inventory", name: "Inventory valuation", path: "/api/reports/inventory/valuation" },
  { group: "Inventory", name: "Stock movement", path: "/api/reports/inventory/movement" },
  { group: "Inventory", name: "Stock levels", path: "/api/reports/inventory/stock-levels" },
  { group: "Sales", name: "Sales summary", path: "/api/reports/sales" },
  { group: "Sales", name: "Sales by product", path: "/api/reports/sales/by-product" },
  { group: "Sales", name: "Sales by cashier", path: "/api/reports/sales/by-cashier" },
  { group: "Procurement", name: "Purchases summary", path: "/api/reports/procurement" },
  { group: "Procurement", name: "Supplier performance", path: "/api/reports/procurement/supplier-performance" },
  { group: "Accounting", name: "General ledger", path: "/api/reports/accounting/general-ledger" },
  { group: "Accounting", name: "Aged receivables", path: "/api/reports/accounting/aged-recivables" },
  { group: "HR", name: "Headcount", path: "/api/reports/hr/headcount" },
  { group: "HR", name: "Attendance summary", path: "/api/reports/hr/attendance-summary" },
  { group: "Butchery", name: "Blocktest vs Actual Sales", path: "/api/reports/butchery/blocktest-reconciliation" },
  { group: "Butchery", name: "Department Trading Account", path: "/api/reports/butchery/department-trading" },
  { group: "Butchery", name: "Low GP Sales Exceptions", path: "/api/reports/butchery/low-gp-sales" },
  { group: "Butchery", name: "Pricing Actions & Margins", path: "/api/reports/butchery/pricing-exceptions" },
];

export default function Reports() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [active, setActive] = useState<string | null>(null);

  const enrich = (path: string) => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    const qs = p.toString();
    return qs ? `${path}?${qs}` : path;
  };

  const q = useQuery({
    queryKey: ["report", active, from, to],
    queryFn: () => api.get<Record<string, unknown>>(active!),
    enabled: Boolean(active),
  });

  const download = async (path: string) => {
    const token = localStorage.getItem("bettererp_token");
    const baseUrl = import.meta.env.VITE_API_URL || "";
    const fetchUrl = baseUrl ? `${baseUrl}${enrich(path)}` : enrich(path);
    const res = await fetch(fetchUrl, { headers: { Authorization: `Bearer ${token}` } });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = path.split("/").pop() + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const rows: Array<Record<string, unknown>> = (q.data?.items as Array<Record<string, unknown>>) ?? [];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <div className="page-subtitle">Run operational and financial reports.</div>
        </div>
        <div className="hstack" style={{ gap: 8 }}>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ maxWidth: 165 }} />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ maxWidth: 165 }} />
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        {REPORTS.map((r) => (
          <Card key={r.path} style={{ padding: 12 }}>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>{r.group}</div>
            <div style={{ fontWeight: 600, fontSize: 13.5, margin: "2px 0 10px" }}>{r.name}</div>
            <div className="hstack" style={{ gap: 6 }}>
              <Button size="sm" onClick={() => setActive(r.path)}>Run</Button>
              <Button size="sm" variant="secondary" onClick={() => download(r.path)}>CSV</Button>
            </div>
          </Card>
        ))}
      </div>

      {active && (
        <Card>
          <div className="hstack mb-2">
            <strong>{REPORTS.find((r) => r.path === active)?.name}</strong>
            <Button size="sm" variant="ghost" onClick={() => setActive(null)}>Close</Button>
          </div>
          {q.isLoading ? <Spinner /> : rows.length === 0 ? <EmptyState text="No rows." /> : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>{Object.keys(rows[0]).map((k) => <th key={k} className="num">{k}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.slice(0, 100).map((r, i) => (
                    <tr key={i}>{Object.values(r).map((v, j) => <td key={j} className="num">{typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(2)) : String(v ?? "")}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 100 && <div className="muted" style={{ marginTop: 8 }}>Showing first 100 rows.</div>}
        </Card>
      )}
    </div>
  );
}