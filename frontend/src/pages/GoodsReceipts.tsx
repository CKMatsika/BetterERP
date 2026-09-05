import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Page } from "../api/client";
import { Button, Card, Field, Input, Modal, Pagination, Spinner, EmptyState, StatusBadge, usePage } from "../components/ui";
import { fmtQty, fmtDateTime } from "../lib/format";
import { useWarehouses } from "../lib/org";

interface GrnRow {
  id: string;
  reference: string;
  status: string;
  receiptDate: string;
  purchaseOrder: { reference: string; supplier: { name: string } } | null;
  warehouse: { name: string } | null;
  lines?: Array<{ product: { sku: string; name: string } | null; quantity: number; description: string | null }>;
}

interface PurchaseOrderOption {
  id: string;
  reference: string;
  status: string;
  supplier: { name: string };
  lines: Array<{ id: string; product: { id: string; sku: string; name: string } | null; quantity: number; receivedQty: number; unitCost: number }>;
}

export default function GoodsReceipts() {
  const qc = useQueryClient();
  const { page, pageSize, setPage } = usePage();
  const warehouses = useWarehouses();
  const [createOpen, setCreateOpen] = useState(false);
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const q = useQuery({
    queryKey: ["grns", page],
    queryFn: () => api.get<Page<GrnRow>>("/api/procurement/goods-receipts", { page, pageSize }),
  });
  const purchaseOrders = useQuery({
    queryKey: ["receivable-purchase-orders"],
    queryFn: () => api.get<Page<PurchaseOrderOption>>("/api/procurement/purchase-orders", { page: 1, pageSize: 500 }),
  });
  const receivableOrders = purchaseOrders.data?.items.filter((po) => ["APPROVED", "PARTIAL_RECEIVED"].includes(po.status)) ?? [];
  const selectedPo = receivableOrders.find((po) => po.id === purchaseOrderId);
  const receiptLines = selectedPo?.lines.map((line) => ({ purchaseOrderLineId: line.id, productId: line.product?.id, quantity: parseFloat(quantities[line.id] ?? "0"), unitCost: line.unitCost })).filter((line) => line.quantity > 0) ?? [];
  const create = useMutation({
    mutationFn: () => api.post("/api/procurement/goods-receipts", { purchaseOrderId, warehouseId, note: note || undefined, lines: receiptLines }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["grns"] }); qc.invalidateQueries({ queryKey: ["receivable-purchase-orders"] }); setCreateOpen(false); setPurchaseOrderId(""); setWarehouseId(""); setQuantities({}); setNote(""); },
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Goods Receipts</h1>
          <div className="page-subtitle">Received stock from purchase orders.</div>
          <div className="page-actions"><Button onClick={() => setCreateOpen(true)}>Receive goods</Button></div>
        </div>
      </div>

      <Card>
        {q.isLoading ? <Spinner /> : q.data!.items.length === 0 ? <EmptyState text="No goods receipts yet. Receive goods from a purchase order." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Reference</th><th>Supplier</th><th>PO</th><th>Warehouse</th><th>Received</th><th>Items</th><th>Status</th></tr></thead>
              <tbody>
                {q.data!.items.map((g) => (
                  <tr key={g.id}>
                    <td style={{ fontWeight: 600 }}>{g.reference}</td>
                    <td>{g.purchaseOrder?.supplier.name ?? "—"}</td>
                    <td>{g.purchaseOrder?.reference ?? "—"}</td>
                    <td>{g.warehouse?.name ?? "—"}</td>
                    <td>{fmtDateTime(g.receiptDate)}</td>
                    <td>{(g.lines ?? []).map((l) => `${l.product?.name ?? l.description ?? "?"} (${fmtQty(l.quantity)})`).join(", ")}</td>
                    <td><StatusBadge status={g.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={pageSize} total={q.data?.total ?? 0} onPage={setPage} />
      </Card>
      <Modal title="Receive goods" open={createOpen} onClose={() => setCreateOpen(false)} className="modal-wide" footer={<><Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button><Button disabled={create.isPending || !purchaseOrderId || !warehouseId || receiptLines.length === 0} onClick={() => create.mutate()}>{create.isPending ? "Posting…" : "Post GRN"}</Button></>}>
        <div className="form-row"><Field label="Purchase order *"><select className="input" value={purchaseOrderId} onChange={(e) => { setPurchaseOrderId(e.target.value); setQuantities({}); }}><option value="">Select receivable PO…</option>{receivableOrders.map((po) => <option key={po.id} value={po.id}>{po.reference} — {po.supplier.name}</option>)}</select></Field><Field label="Warehouse *"><select className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}><option value="">Select…</option>{warehouses.data?.items.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></Field></div>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional receiving note" /></Field>
        {!selectedPo ? <EmptyState text="Select an approved purchase order to enter received quantities." /> : <div className="table-wrap"><table className="table"><thead><tr><th>Product</th><th className="num">Remaining</th><th className="num">Received now</th></tr></thead><tbody>{selectedPo.lines.map((line) => { const remaining = Number(line.quantity) - Number(line.receivedQty ?? 0); return <tr key={line.id}><td>{line.product?.name ?? "Unspecified item"}<div className="muted">{line.product?.sku ?? ""}</div></td><td className="num">{fmtQty(remaining)}</td><td className="num"><Input type="number" min={0} max={remaining} step="any" value={quantities[line.id] ?? ""} onChange={(e) => setQuantities((previous) => ({ ...previous, [line.id]: e.target.value }))} style={{ maxWidth: 130, marginLeft: "auto" }} /></td></tr>; })}</tbody></table></div>}
        {create.isError && <div className="login-error">{(create.error as Error).message}</div>}
      </Modal>
    </div>
  );
}