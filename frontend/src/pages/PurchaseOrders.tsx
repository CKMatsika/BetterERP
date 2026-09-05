import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Page } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Input, Field, Modal, Pagination, Spinner, EmptyState, StatusBadge, usePage } from "../components/ui";
import { fmtMoney, fmtDate } from "../lib/format";
import { useProductOptions, useWarehouses } from "../lib/org";

interface PoRow {
  id: string;
  reference: string;
  status: string;
  supplier: { id: string; name: string };
  branch: { id: string; code: string; name: string } | null;
  total: number;
  orderDate: string;
  lines?: Array<{ product: { sku: string; name: string } | null; description: string | null; quantity: number }>;
}
interface SupplierOpt { id: string; name: string }

export default function PurchaseOrders() {
  const qc = useQueryClient();
  const { page, pageSize, setPage } = usePage();
  const { user } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const wh = useWarehouses();
  const products = useProductOptions();

  const [supplierId, setSupplierId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Array<{ productId: string; qty: string; unitCost: string }>>([{ productId: "", qty: "", unitCost: "" }]);

  const q = useQuery({
    queryKey: ["pos", page],
    queryFn: () => api.get<Page<PoRow>>("/api/procurement/purchase-orders", { page, pageSize }),
  });
  const suppliers = useQuery({ queryKey: ["suppliers", "opts"], queryFn: () => api.get<{ items: SupplierOpt[] }>("/api/procurement/suppliers", { page: 1, pageSize: 500 }) });

  const create = useMutation({
    mutationFn: () =>
      api.post("/api/procurement/purchase-orders", {
        supplierId,
        expectedDate: expectedDate || undefined,
        notes: note || undefined,
        lines: lines.filter((l) => l.productId && parseFloat(l.qty) > 0).map((l) => ({ productId: l.productId, quantity: parseFloat(l.qty), unitCost: parseFloat(l.unitCost) || 0 })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pos"] });
      setCreateOpen(false);
      setSupplierId(""); setExpectedDate(""); setNote(""); setLines([{ productId: "", qty: "", unitCost: "" }]);
    },
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "cancel" }) => api.post(`/api/procurement/purchase-orders/${id}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pos"] }),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Purchase Orders</h1>
          <div className="page-subtitle">Orders to suppliers awaiting receipt.</div>
        </div>
        <div className="page-actions"><Button onClick={() => setCreateOpen(true)}>New purchase order</Button></div>
      </div>

      <Card>
        {q.isLoading ? <Spinner /> : q.data!.items.length === 0 ? <EmptyState text="No purchase orders yet." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Reference</th><th>Supplier</th><th>Branch</th><th>Order date</th><th>Expected</th><th className="num">Total</th><th>Status</th><th /></tr></thead>
              <tbody>
                {q.data!.items.map((po) => (
                  <tr key={po.id}>
                    <td style={{ fontWeight: 600 }}>{po.reference}</td>
                    <td>{po.supplier.name}</td>
                    <td>{po.branch?.code ?? "—"}</td>
                    <td>{fmtDate(po.orderDate)}</td>
                    <td>{po.lines?.length ?? 0} line(s)</td>
                    <td className="num">{fmtMoney(po.total)}</td>
                    <td><StatusBadge status={po.status} /></td>
                    <td className="right">
                      {po.status === "PENDING_APPROVAL" && user?.permissions.includes("purchase.approve") && <Button size="sm" variant="secondary" onClick={() => act.mutate({ id: po.id, action: "approve" })}>Approve</Button>}
                      {["PENDING_APPROVAL", "APPROVED"].includes(po.status) && <Button size="sm" variant="danger" onClick={() => act.mutate({ id: po.id, action: "cancel" })}>Cancel</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={pageSize} total={q.data?.total ?? 0} onPage={setPage} />
      </Card>

      <Modal
        title="New purchase order"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        className="modal-wide"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button disabled={create.isPending || !supplierId || lines.filter((l) => l.productId && parseFloat(l.qty) > 0).length === 0} onClick={() => create.mutate()}>
              {create.isPending ? "Creating…" : "Create PO"}
            </Button>
          </>
        }
      >
        <div className="form-row">
          <Field label="Supplier *">
            <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Select…</option>
              {suppliers.data?.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Expected delivery"><Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></Field>
        </div>
        <Field label="Notes"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Product</th><th style={{ width: 110 }}>Qty</th><th style={{ width: 130 }}>Unit cost</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <select className="input" value={l.productId} onChange={(e) => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, productId: e.target.value } : x)))}>
                      <option value="">Select product…</option>
                      {products.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                    </select>
                  </td>
                  <td><Input type="number" min={1} step="any" value={l.qty} onChange={(e) => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></td>
                  <td><Input type="number" min={0} step="any" value={l.unitCost} onChange={(e) => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, unitCost: e.target.value } : x)))} /></td>
                  <td className="right"><Button size="sm" variant="ghost" onClick={() => setLines((prev) => prev.length > 1 ? prev.filter((_, j) => j !== i) : prev)}>Remove</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setLines((prev) => [...prev, { productId: "", qty: "", unitCost: "" }])}>Add line</Button>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Order is created for {wh.branchId ? "your branch" : "the first branch"}.</div>
        {create.isError && <div className="login-error">{(create.error as Error).message}</div>}
      </Modal>
    </div>
  );
}