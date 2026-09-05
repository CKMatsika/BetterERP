import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Card, StatCard, Spinner, EmptyState, Badge } from "../components/ui";
import { fmtMoney, fmtDate } from "../lib/format";

interface Summary {
  today: { sales: number; transactions: number };
  month: { sales: number; transactions: number };
  inventory: { value: number; units: number };
  lowStockItems: number;
  pendingPurchaseOrders: number;
  customers: number;
  receivables: number;
  payables: number;
}

interface TrendItem { date: string; sales: number; count: number }
interface AlertRes {
  lowStock: number;
  lowStockItems: Array<{ product: { id: string; sku: string; name: string; reorderLevel: number }; warehouse: string; available: number; reorderLevel: number }>;
  pendingApprovals: number;
  overdueInvoices: number;
}
interface BranchPerf { id: string; code: string; name: string; monthSales: number; saleCount: number; customers: number }
interface RecentSale { id: string; reference: string; total: number; saleDate: string; cashier: { fullName: string } | null; customer: { name: string } | null }

export default function Dashboard() {
  const { user } = useAuth();
  const summary = useQuery({ queryKey: ["dash", "summary"], queryFn: () => api.get<Summary>("/api/dashboard/summary") });
  const trend = useQuery({ queryKey: ["dash", "trend"], queryFn: () => api.get<{ items: TrendItem[] }>("/api/dashboard/sales-trend?days=14") });
  const alerts = useQuery({ queryKey: ["dash", "alerts"], queryFn: () => api.get<AlertRes>("/api/dashboard/alerts") });
  const branches = useQuery({
    queryKey: ["dash", "branches"],
    queryFn: () => api.get<{ items: BranchPerf[] }>("/api/dashboard/branch-performance"),
    enabled: Boolean(user?.canViewAllBranches),
  });
  const recent = useQuery({ queryKey: ["dash", "recent"], queryFn: () => api.get<{ items: RecentSale[] }>("/api/dashboard/recent-sales") });

  if (summary.isLoading) return <Spinner label="Loading dashboard…" />;
  if (summary.isError) return <EmptyState text="Could not load dashboard. Is the backend running?" />;
  const s = summary.data;
  if (!s) return <EmptyState text="Dashboard data is unavailable." />;

  const maxTrend = Math.max(1, ...(trend.data?.items.map((i) => i.sales) ?? [0]));

  return (
    <div className="stack">
      <div className="grid grid-4">
        <StatCard label="Sales Today" value={fmtMoney(s.today.sales)} sub={`${s.today.transactions} transaction${s.today.transactions === 1 ? "" : "s"}`} tone={s.today.sales > 0 ? "green" : undefined} />
        <StatCard label="Sales This Month" value={fmtMoney(s.month.sales)} sub={`${s.month.transactions} transaction${s.month.transactions === 1 ? "" : "s"}`} />
        <StatCard label="Inventory Value" value={fmtMoney(s.inventory.value)} sub={`${s.inventory.units.toLocaleString()} units`} />
        <StatCard label="Receivables" value={fmtMoney(s.receivables)} sub={`Payables: ${fmtMoney(s.payables)}`} tone={s.receivables > 0 ? "amber" : undefined} />
      </div>

      <div className="grid grid-2">
        <Card title="Sales — last 14 days">
          {trend.isLoading ? <Spinner /> : (
            <div>
              <div className="chart-bars">
                {trend.data!.items.map((i) => (
                  <div key={i.date} className={`chart-bar${i.sales === 0 ? " empty" : ""}`} style={{ height: `${Math.max(2, (i.sales / maxTrend) * 100)}%` }} title={`${fmtDate(i.date)}: ${fmtMoney(i.sales)}`} />
                ))}
              </div>
              <div className="muted mt-2" style={{ fontSize: 11.5 }}>Hover bars for detail. Daily sales total.</div>
            </div>
          )}
        </Card>

        <Card title="Alerts">
          {alerts.isLoading ? <Spinner /> : (
            <div className="stack">
              <div className="grid grid-3" style={{ textAlign: "center" }}>
                <StatCard label="Low Stock" value={alerts.data!.lowStock} tone={alerts.data!.lowStock > 0 ? "red" : undefined} />
                <StatCard label="Pending Approvals" value={alerts.data!.pendingApprovals} tone={alerts.data!.pendingApprovals > 0 ? "amber" : undefined} />
                <StatCard label="Overdue Invoices" value={alerts.data!.overdueInvoices} tone={alerts.data!.overdueInvoices > 0 ? "red" : undefined} />
              </div>
              {alerts.data!.lowStockItems.length > 0 && (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Product</th><th>Warehouse</th><th className="num">Available</th><th className="num">Reorder level</th></tr></thead>
                    <tbody>
                      {alerts.data!.lowStockItems.map((it) => (
                        <tr key={`${it.product.id}-${it.warehouse}`}>
                          <td>{it.product.name} <span className="muted">({it.product.sku})</span></td>
                          <td>{it.warehouse}</td>
                          <td className="num"><Badge tone="amber">{it.available}</Badge></td>
                          <td className="num">{it.reorderLevel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="muted" style={{ fontSize: 12.5 }}>
                <Link to="/inventory/stock">Check reorder points →</Link>
              </div>
            </div>
          )}
        </Card>
      </div>

      {branches.data && branches.data.items.length > 0 && (
        <Card title="Branch performance (this month)">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Branch</th><th className="num">Sales</th><th className="num">Transactions</th><th className="num">Customers</th></tr></thead>
              <tbody>
                {branches.data.items.map((b) => (
                  <tr key={b.id}>
                    <td>{b.name} <span className="muted">({b.code})</span></td>
                    <td className="num">{fmtMoney(b.monthSales)}</td>
                    <td className="num">{b.saleCount}</td>
                    <td className="num">{b.customers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="Recent sales">
        {recent.isLoading ? <Spinner /> : recent.data!.items.length === 0 ? (
          <EmptyState text="No sales yet. Open the POS to make your first sale." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Reference</th><th>Date</th><th>Cashier</th><th>Customer</th><th className="num">Total</th></tr></thead>
              <tbody>
                {recent.data!.items.map((r) => (
                  <tr key={r.id}>
                    <td>{r.reference}</td>
                    <td>{fmtDate(r.saleDate)}</td>
                    <td>{r.cashier?.fullName ?? "—"}</td>
                    <td>{r.customer?.name ?? "—"}</td>
                    <td className="num">{fmtMoney(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}