import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api, type Page } from "../api/client";
import { Button, Card, Input, Pagination, Spinner, EmptyState, Badge, usePage } from "../components/ui";
import { fmtMoney, fmtQty } from "../lib/format";

interface StockRow {
  id: string;
  onHand: number;
  available: number;
  value: number;
  product: { id: string; sku: string; name: string; reorderLevel: number | null };
  warehouse: { id: string; name: string; branch: { id: string; code: string; name: string } };
}

interface ReorderRes { items: Array<{ product: { sku: string; name: string; reorderLevel: number; reorderQuantity: number }; warehouse: { name: string }; available: number; suggestion: number }>; count: number }

export default function Stock() {
  const { page, pageSize, setPage } = usePage();
  const [search, setSearch] = useState("");
  const [report, setReport] = useState<ReorderRes | null>(null);

  const q = useQuery({
    queryKey: ["stock", page, search.trim()],
    queryFn: () => api.get<Page<StockRow>>("/api/inventory/stock", { page, pageSize, search: search.trim() || undefined }),
  });

  const check = useMutation({
    mutationFn: () => api.post<ReorderRes>("/api/inventory/check-reorders"),
    onSuccess: (d) => setReport(d),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Stock on Hand</h1>
          <div className="page-subtitle">Available quantities by warehouse.</div>
        </div>
        <div className="page-actions">
          <Button variant="secondary" disabled={check.isPending} onClick={() => check.mutate()}>
            {check.isPending ? "Checking…" : "Check reorder points"}
          </Button>
        </div>
      </div>

      {report && (
        <Card title={`Reorder report — ${report.count} item${report.count === 1 ? "" : "s"} at or below reorder level`} className="mb-2" actions={<Button variant="ghost" size="sm" onClick={() => setReport(null)}>Dismiss</Button>}>
          {report.items.length === 0 ? <EmptyState text="All stock above reorder levels." /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Product</th><th>SKU</th><th>Warehouse</th><th className="num">Available</th><th className="num">Reorder level</th><th className="num">Suggested qty</th></tr></thead>
                <tbody>
                  {report.items.map((r, i) => (
                    <tr key={i}>
                      <td>{r.product.name}</td><td>{r.product.sku}</td><td>{r.warehouse.name}</td>
                      <td className="num"><Badge tone={r.available <= r.product.reorderLevel ? "red" : "amber"}>{fmtQty(r.available)}</Badge></td>
                      <td className="num">{fmtQty(r.product.reorderLevel)}</td>
                      <td className="num">{fmtQty(r.suggestion)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card>
        <div className="hstack mb-2" style={{ padding: "2px 0 12px" }}>
          <Input placeholder="Search product or warehouse…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={{ maxWidth: 340 }} />
        </div>
        {q.isLoading ? <Spinner /> : q.data!.items.length === 0 ? <EmptyState text="No stock balances yet." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Product</th><th>Warehouse</th><th>Branch</th><th className="num">On hand</th><th className="num">Available</th><th className="num">Value</th></tr></thead>
              <tbody>
                {q.data!.items.map((b) => (
                  <tr key={b.id}>
                    <td>{b.product.name} <span className="muted">({b.product.sku})</span></td>
                    <td>{b.warehouse.name}</td>
                    <td>{b.warehouse.branch.code}</td>
                    <td className="num">{fmtQty(b.onHand)}</td>
                    <td className="num">{fmtQty(b.available)}</td>
                    <td className="num">{fmtMoney(b.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={pageSize} total={q.data?.total ?? 0} onPage={setPage} />
      </Card>
    </div>
  );
}