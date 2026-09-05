import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Page } from "../api/client";
import { Button, Card, Field, Input, Modal, Pagination, Spinner, EmptyState, StatusBadge, usePage } from "../components/ui";
import { fmtDate, fmtMoney, fmtQty } from "../lib/format";
import { useProductOptions, useWarehouses } from "../lib/org";

interface ReturnRow { id: string; reference: string; returnDate: string; reason: string | null; status: string; total: number; lines: Array<{ product: { sku: string; name: string } | null; quantity: number; unitCost: number }> }

export default function PurchaseReturns() {
  const qc = useQueryClient();
  const { page, pageSize, setPage } = usePage();
  const products = useProductOptions();
  const warehouses = useWarehouses();
  const suppliers = useQuery({ queryKey: ["suppliers", "return-options"], queryFn: () => api.get<{ items: Array<{ id: string; name: string }> }>("/api/procurement/suppliers", { page: 1, pageSize: 500 }) });
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Array<{ productId: string; quantity: string; unitCost: string }>>([{ productId: "", quantity: "", unitCost: "" }]);
  const q = useQuery({ queryKey: ["purchase-returns", page], queryFn: () => api.get<Page<ReturnRow>>("/api/procurement/purchase-returns", { page, pageSize }) });
  const create = useMutation({
    mutationFn: () => api.post("/api/procurement/purchase-returns", { supplierId, warehouseId, reason: reason || undefined, lines: lines.filter((line) => line.productId && parseFloat(line.quantity) > 0).map((line) => ({ productId: line.productId, quantity: parseFloat(line.quantity), unitCost: parseFloat(line.unitCost) || 0 })) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["purchase-returns"] }); qc.invalidateQueries({ queryKey: ["stock"] }); setOpen(false); setSupplierId(""); setWarehouseId(""); setReason(""); setLines([{ productId: "", quantity: "", unitCost: "" }]); },
  });
  const validLines = lines.filter((line) => line.productId && parseFloat(line.quantity) > 0);

  return <div>
    <div className="page-header"><div><h1 className="page-title">Purchase Returns</h1><div className="page-subtitle">Return stock to suppliers and create supplier credits.</div></div><div className="page-actions"><Button onClick={() => setOpen(true)}>New purchase return</Button></div></div>
    <Card>{q.isLoading ? <Spinner /> : q.data?.items.length === 0 ? <EmptyState text="No purchase returns yet." /> : <div className="table-wrap"><table className="table"><thead><tr><th>Reference</th><th>Date</th><th>Supplier</th><th>Items</th><th className="num">Total</th><th>Status</th></tr></thead><tbody>{q.data?.items.map((item) => <tr key={item.id}><td style={{ fontWeight: 600 }}>{item.reference}</td><td>{fmtDate(item.returnDate)}</td><td>Supplier credit</td><td>{item.lines.map((line) => `${line.product?.name ?? "?"} (${fmtQty(line.quantity)})`).join(", ")}</td><td className="num">{fmtMoney(item.total)}</td><td><StatusBadge status={item.status} /></td></tr>)}</tbody></table></div>}<Pagination page={page} pageSize={pageSize} total={q.data?.total ?? 0} onPage={setPage} /></Card>
    <Modal title="New purchase return" open={open} onClose={() => setOpen(false)} className="modal-wide" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger" disabled={create.isPending || !supplierId || !warehouseId || validLines.length === 0} onClick={() => create.mutate()}>{create.isPending ? "Posting…" : "Post return"}</Button></>}>
      <div className="form-row"><Field label="Supplier *"><select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Select supplier…</option>{suppliers.data?.items.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></Field><Field label="Warehouse *"><select className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}><option value="">Select warehouse…</option>{warehouses.data?.items.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></Field></div>
      <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="table-wrap"><table className="table"><thead><tr><th>Product</th><th style={{ width: 130 }}>Quantity</th><th style={{ width: 150 }}>Unit cost</th><th /></tr></thead><tbody>{lines.map((line, index) => <tr key={index}><td><select className="input" value={line.productId} onChange={(e) => setLines((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, productId: e.target.value } : item))}><option value="">Select product…</option>{products.data?.items.map((product) => <option key={product.id} value={product.id}>{product.name} ({product.sku})</option>)}</select></td><td><Input type="number" min={0} step="any" value={line.quantity} onChange={(e) => setLines((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: e.target.value } : item))} /></td><td><Input type="number" min={0} step="any" value={line.unitCost} onChange={(e) => setLines((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, unitCost: e.target.value } : item))} /></td><td className="right"><Button size="sm" variant="ghost" onClick={() => setLines((previous) => previous.length > 1 ? previous.filter((_, itemIndex) => itemIndex !== index) : previous)}>Remove</Button></td></tr>)}</tbody></table></div>
      <Button variant="secondary" size="sm" onClick={() => setLines((previous) => [...previous, { productId: "", quantity: "", unitCost: "" }])}>Add line</Button>
      {create.isError && <div className="login-error">{(create.error as Error).message}</div>}
    </Modal>
  </div>;
}
