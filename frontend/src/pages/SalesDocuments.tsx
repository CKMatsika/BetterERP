import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Page } from "../api/client";
import { Button, Card, Field, Input, Modal, Pagination, Spinner, EmptyState, StatusBadge, usePage } from "../components/ui";
import { fmtDate, fmtMoney, fmtQty } from "../lib/format";
import { useProductOptions } from "../lib/org";
import { useWarehouses } from "../lib/org";

type DocumentType = "quotations" | "sales-orders";
interface DocumentRow { id: string; reference: string; status: string; customerId: string | null; orderDate?: string; validUntil?: string | null; total: number; lines: Array<{ productId: string | null; quantity: number; unitPrice: number; product?: { name: string; sku: string } | null }> }

export default function SalesDocuments() {
  const qc = useQueryClient();
  const { page, pageSize, setPage } = usePage();
  const products = useProductOptions();
  const warehouses = useWarehouses();
  const customers = useQuery({ queryKey: ["customers", "document-options"], queryFn: () => api.get<{ items: Array<{ id: string; name: string }> }>("/api/customers", { page: 1, pageSize: 500 }) });
  const [type, setType] = useState<DocumentType>("quotations");
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [lines, setLines] = useState<Array<{ productId: string; quantity: string; unitPrice: string; discount: string }>>([{ productId: "", quantity: "", unitPrice: "", discount: "0" }]);
  const [fulfillId, setFulfillId] = useState<string | null>(null);
  const [fulfillWarehouseId, setFulfillWarehouseId] = useState("");
  const q = useQuery({ queryKey: [type, page], queryFn: () => api.get<Page<DocumentRow>>(`/api/sales/${type}`, { page, pageSize }) });
  const create = useMutation({
    mutationFn: () => api.post(`/api/sales/${type}`, { customerId: customerId || undefined, validUntil: validUntil || undefined, lines: lines.filter((line) => line.productId && parseFloat(line.quantity) > 0).map((line) => ({ productId: line.productId, quantity: parseFloat(line.quantity), unitPrice: parseFloat(line.unitPrice) || 0, discount: parseFloat(line.discount) || 0 })) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [type] }); setOpen(false); setCustomerId(""); setValidUntil(""); setLines([{ productId: "", quantity: "", unitPrice: "", discount: "0" }]); },
  });
  const action = useMutation({
    mutationFn: ({ id, operation }: { id: string; operation: "convert" | "approve" | "cancel" }) => api.post(`/api/sales/${type}/${id}/${operation}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [type] }),
  });
  const fulfill = useMutation({
    mutationFn: () => api.post(`/api/sales/sales-orders/${fulfillId}/fulfill`, { warehouseId: fulfillWarehouseId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sales-orders"] }); setFulfillId(null); setFulfillWarehouseId(""); },
  });
  const validLines = lines.filter((line) => line.productId && parseFloat(line.quantity) > 0);

  return <div>
    <div className="page-header"><div><h1 className="page-title">Quotes &amp; Sales Orders</h1><div className="page-subtitle">Create commercial documents without posting inventory until a sale is completed.</div></div><div className="page-actions"><Button onClick={() => setOpen(true)}>New {type === "quotations" ? "quotation" : "sales order"}</Button></div></div>
    <div className="hstack mb-2"><Button size="sm" variant={type === "quotations" ? "primary" : "secondary"} onClick={() => { setType("quotations"); setPage(1); }}>Quotations</Button><Button size="sm" variant={type === "sales-orders" ? "primary" : "secondary"} onClick={() => { setType("sales-orders"); setPage(1); }}>Sales orders</Button></div>
    <Card>{q.isLoading ? <Spinner /> : q.data?.items.length === 0 ? <EmptyState text={`No ${type === "quotations" ? "quotations" : "sales orders"} yet.`} /> : <div className="table-wrap"><table className="table"><thead><tr><th>Reference</th><th>Date</th><th>Status</th><th className="num">Items</th><th className="num">Total</th><th /></tr></thead><tbody>{q.data?.items.map((item) => <tr key={item.id}><td style={{ fontWeight: 600 }}>{item.reference}</td><td>{fmtDate(item.orderDate ?? item.validUntil ?? "")}</td><td><StatusBadge status={item.status} /></td><td className="num">{item.lines.reduce((sum, line) => sum + Number(line.quantity), 0)} ({item.lines.map((line) => `${line.product?.name ?? "item"} ${fmtQty(line.quantity)}`).join(", ")})</td><td className="num">{fmtMoney(item.total)}</td><td className="right">{type === "quotations" && ["DRAFT", "SENT", "ACCEPTED"].includes(item.status) && <Button size="sm" onClick={() => action.mutate({ id: item.id, operation: "convert" })}>Convert to order</Button>}{type === "sales-orders" && item.status === "DRAFT" && <Button size="sm" onClick={() => action.mutate({ id: item.id, operation: "approve" })}>Approve</Button>}{type === "sales-orders" && item.status === "APPROVED" && <Button size="sm" onClick={() => setFulfillId(item.id)}>Fulfill</Button>}{type === "sales-orders" && ["DRAFT", "APPROVED"].includes(item.status) && <Button size="sm" variant="danger" onClick={() => action.mutate({ id: item.id, operation: "cancel" })}>Cancel</Button>}</td></tr>)}</tbody></table></div>}<Pagination page={page} pageSize={pageSize} total={q.data?.total ?? 0} onPage={setPage} /></Card>
    <Modal title={`New ${type === "quotations" ? "quotation" : "sales order"}`} open={open} onClose={() => setOpen(false)} className="modal-wide" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={create.isPending || validLines.length === 0} onClick={() => create.mutate()}>{create.isPending ? "Saving…" : "Save document"}</Button></>}>
      <div className="form-row"><Field label="Customer"><select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">Walk-in / unspecified</option>{customers.data?.items.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></Field>{type === "quotations" && <Field label="Valid until"><Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>}</div>
      <div className="table-wrap"><table className="table"><thead><tr><th>Product</th><th style={{ width: 110 }}>Qty</th><th style={{ width: 140 }}>Unit price</th><th style={{ width: 120 }}>Discount</th><th /></tr></thead><tbody>{lines.map((line, index) => <tr key={index}><td><select className="input" value={line.productId} onChange={(e) => setLines((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, productId: e.target.value } : item))}><option value="">Select product…</option>{products.data?.items.map((product) => <option key={product.id} value={product.id}>{product.name} ({product.sku})</option>)}</select></td><td><Input type="number" min={0} step="any" value={line.quantity} onChange={(e) => setLines((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: e.target.value } : item))} /></td><td><Input type="number" min={0} step="any" value={line.unitPrice} onChange={(e) => setLines((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, unitPrice: e.target.value } : item))} /></td><td><Input type="number" min={0} step="any" value={line.discount} onChange={(e) => setLines((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, discount: e.target.value } : item))} /></td><td className="right"><Button size="sm" variant="ghost" onClick={() => setLines((previous) => previous.length > 1 ? previous.filter((_, itemIndex) => itemIndex !== index) : previous)}>Remove</Button></td></tr>)}</tbody></table></div>
      <Button variant="secondary" size="sm" onClick={() => setLines((previous) => [...previous, { productId: "", quantity: "", unitPrice: "", discount: "0" }])}>Add line</Button>
      {create.isError && <div className="login-error">{(create.error as Error).message}</div>}
    </Modal>
    <Modal title="Fulfill sales order" open={Boolean(fulfillId)} onClose={() => setFulfillId(null)} footer={<><Button variant="secondary" onClick={() => setFulfillId(null)}>Cancel</Button><Button disabled={fulfill.isPending || !fulfillWarehouseId} onClick={() => fulfill.mutate()}>{fulfill.isPending ? "Posting…" : "Fulfill order"}</Button></>}>
      <Field label="Warehouse *"><select className="input" value={fulfillWarehouseId} onChange={(e) => setFulfillWarehouseId(e.target.value)}><option value="">Select warehouse…</option>{warehouses.data?.items.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></Field>
      <div className="muted" style={{ marginTop: 10 }}>Fulfillment creates a credit invoice, reduces stock, posts accounting entries, and marks the order fulfilled.</div>
      {fulfill.isError && <div className="login-error">{(fulfill.error as Error).message}</div>}
    </Modal>
  </div>;
}
