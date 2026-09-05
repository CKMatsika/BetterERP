import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Page } from "../api/client";
import { Button, Card, Input, Field, Modal, Pagination, Spinner, EmptyState, StatusBadge, usePage } from "../components/ui";
import { fmtDateTime } from "../lib/format";
import { useWarehouses, useProductOptions } from "../lib/org";

interface AdjustmentRow {
  id: string;
  reference: string;
  type: string;
  status: string;
  note: string | null;
  postedAt: string | null;
  warehouse: { name: string };
  lines?: Array<{ product: { sku: string; name: string }; adjustment: number }>;
}

export default function Adjustments() {
  const qc = useQueryClient();
  const { page, pageSize, setPage } = usePage();
  const [createOpen, setCreateOpen] = useState(false);
  const warehouses = useWarehouses();
  const products = useProductOptions();
  const q = useQuery({
    queryKey: ["adjustments", page],
    queryFn: () => api.get<Page<AdjustmentRow>>("/api/inventory/adjustments", { page, pageSize }),
  });

  const [warehouseId, setWarehouseId] = useState("");
  const [type, setType] = useState("STOCK_ADJUSTMENT");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Array<{ productId: string; adjustment: string }>>([{ productId: "", adjustment: "" }]);

  const create = useMutation({
    mutationFn: () =>
      api.post("/api/inventory/adjustments", {
        warehouseId,
        type,
        reason,
        lines: lines.filter((l) => l.productId && parseFloat(l.adjustment) > 0).map((l) => ({ productId: l.productId, adjustment: parseFloat(l.adjustment) })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["adjustments"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
      setCreateOpen(false);
      setWarehouseId(""); setType("STOCK_ADJUSTMENT"); setReason(""); setLines([{ productId: "", adjustment: "" }]);
    },
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Stock Adjustments</h1>
          <div className="page-subtitle">Adjust, damage, write-off and internal consumption.</div>
        </div>
        <div className="page-actions"><Button onClick={() => setCreateOpen(true)}>New adjustment</Button></div>
      </div>

      <Card>
        {q.isLoading ? <Spinner /> : q.data!.items.length === 0 ? <EmptyState text="No adjustments yet." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Reference</th><th>Type</th><th>Warehouse</th><th>Reason</th><th>Posted</th><th>Status</th></tr></thead>
              <tbody>
                {q.data!.items.map((a) => (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 600 }}>{a.reference}</td>
                    <td>{a.type}</td>
                    <td>{a.warehouse.name}</td>
                    <td>{a.note ?? "—"}</td>
                    <td>{a.postedAt ? fmtDateTime(a.postedAt) : "—"}</td>
                    <td><StatusBadge status={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={pageSize} total={q.data?.total ?? 0} onPage={setPage} />
      </Card>

      <Modal
        title="New stock adjustment"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        className="modal-wide"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              disabled={create.isPending || !warehouseId || lines.filter((l) => l.productId && parseFloat(l.adjustment) > 0).length === 0}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "Posting…" : "Post adjustment"}
            </Button>
          </>
        }
      >
        <div className="form-row-3">
          <Field label="Warehouse *">
            <select className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Select…</option>
              {warehouses.data?.items.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="STOCK_ADJUSTMENT">Stock adjustment</option>
              <option value="DAMAGE">Damage</option>
              <option value="WRITE_OFF">Write-off</option>
              <option value="INTERNAL_CONSUMPTION">Internal consumption</option>
            </select>
          </Field>
          <Field label="Reason *"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Product</th><th style={{ width: 140 }}>Quantity</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <select className="input" value={l.productId} onChange={(e) => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, productId: e.target.value } : x)))}>
                      <option value="">Select product…</option>
                      {products.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                    </select>
                  </td>
                  <td>
                    <Input type="number" min={0} step="any" value={l.adjustment} onChange={(e) => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, adjustment: e.target.value } : x)))} />
                  </td>
                  <td className="right">
                    <Button size="sm" variant="ghost" onClick={() => setLines((prev) => prev.length > 1 ? prev.filter((_, j) => j !== i) : prev)}>Remove</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setLines((prev) => [...prev, { productId: "", adjustment: "" }])}>Add line</Button>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>DAMAGE / WRITE_OFF / INTERNAL_CONSUMPTION reduce stock; plain adjustments add stock. Posted against your branch.</div>
        {create.isError && <div className="login-error">{(create.error as Error).message}</div>}
      </Modal>
    </div>
  );
}