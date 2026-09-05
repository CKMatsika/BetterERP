import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Page } from "../api/client";
import { Button, Card, Field, Input, Modal, Pagination, Spinner, EmptyState, StatusBadge, Badge, usePage } from "../components/ui";
import { fmtMoney, fmtDate } from "../lib/format";
import { useProductOptions } from "../lib/org";

interface InvRow {
  id: string;
  reference: string;
  docReference: string | null;
  status: string;
  totals?: {
    invoiceTotal: number;
    paidAmount: number;
    outstandingBalance: number;
  };
  supplier: { id: string; name: string } | null;
  branch: { code: string } | null;
  invoiceDate: string;
  dueDate: string | null;
}

export default function SupplierInvoices() {
  const qc = useQueryClient();
  const { page, pageSize, setPage } = usePage();
  const products = useProductOptions();
  const [createOpen, setCreateOpen] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState<InvRow | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("BANK_TRANSFER");
  const [supplierId, setSupplierId] = useState("");
  const [reference, setReference] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [lines, setLines] = useState<Array<{ productId: string; quantity: string; unitCost: string }>>([{ productId: "", quantity: "", unitCost: "" }]);
  const q = useQuery({
    queryKey: ["supplier-invoices", page],
    queryFn: () => api.get<Page<InvRow>>("/api/procurement/supplier-invoices", { page, pageSize }),
  });
  const suppliers = useQuery({ queryKey: ["suppliers", "invoice-options"], queryFn: () => api.get<{ items: Array<{ id: string; name: string }> }>("/api/procurement/suppliers", { page: 1, pageSize: 500 }) });
  const create = useMutation({
    mutationFn: () => api.post("/api/procurement/supplier-invoices", {
      supplierId, reference, invoiceDate: invoiceDate || undefined, dueDate: dueDate || undefined,
      lines: lines.filter((line) => line.productId && parseFloat(line.quantity) > 0).map((line) => ({ productId: line.productId, quantity: parseFloat(line.quantity), unitCost: parseFloat(line.unitCost) || 0 })),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["supplier-invoices"] }); setCreateOpen(false); setSupplierId(""); setReference(""); setInvoiceDate(""); setDueDate(""); setLines([{ productId: "", quantity: "", unitCost: "" }]); },
  });
  const payment = useMutation({
    mutationFn: () => api.post("/api/procurement/supplier-payments", {
      supplierId: paymentInvoice?.supplier?.id,
      invoiceId: paymentInvoice?.id,
      amount: parseFloat(paymentAmount),
      paymentMethod,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["supplier-invoices"] }); setPaymentInvoice(null); setPaymentAmount(""); setPaymentMethod("BANK_TRANSFER"); },
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Supplier Invoices</h1>
          <div className="page-subtitle">Invoices awaiting payment.</div>
          <div className="page-actions"><Button onClick={() => setCreateOpen(true)}>Record invoice</Button></div>
        </div>
      </div>

      <Card>
        {q.isLoading ? <Spinner /> : q.data!.items.length === 0 ? <EmptyState text="No supplier invoices yet." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Reference</th><th>Supplier</th><th>Branch</th><th>Invoice date</th><th>Due</th><th className="num">Total</th><th className="num">Paid</th><th className="num">Outstanding</th><th>Status</th></tr></thead>
              <tbody>
                {q.data!.items.map((inv) => {
                  const o = inv.totals?.outstandingBalance ?? 0;
                  return (
                    <tr key={inv.id}>
                      <td style={{ fontWeight: 600 }}>{inv.reference}</td>
                      <td>{inv.supplier?.name ?? "—"}</td>
                      <td>{inv.branch?.code ?? "—"}</td>
                      <td>{fmtDate(inv.invoiceDate)}</td>
                      <td>{inv.dueDate ? fmtDate(inv.dueDate) : "—"}</td>
                      <td className="num">{fmtMoney(inv.totals?.invoiceTotal ?? 0)}</td>
                      <td className="num">{fmtMoney(inv.totals?.paidAmount ?? 0)}</td>
                      <td className="num">{o > 0 ? <Badge tone="amber">{fmtMoney(o)}</Badge> : "—"}</td>
                      <td><StatusBadge status={inv.status} /></td>
                      <td className="right">{o > 0 && inv.supplier && <Button size="sm" variant="secondary" onClick={() => { setPaymentInvoice(inv); setPaymentAmount(String(o)); }}>Pay</Button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={pageSize} total={q.data?.total ?? 0} onPage={setPage} />
      </Card>
      <Modal title="Record supplier invoice" open={createOpen} onClose={() => setCreateOpen(false)} className="modal-wide" footer={<><Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button><Button disabled={create.isPending || !supplierId || !reference || lines.filter((line) => line.productId && parseFloat(line.quantity) > 0).length === 0} onClick={() => create.mutate()}>{create.isPending ? "Posting…" : "Post invoice"}</Button></>}>
        <div className="form-row"><Field label="Supplier *"><select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Select supplier…</option>{suppliers.data?.items.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></Field><Field label="Supplier invoice number *"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field></div>
        <div className="form-row"><Field label="Invoice date"><Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></Field><Field label="Due date"><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field></div>
        <div className="table-wrap"><table className="table"><thead><tr><th>Product</th><th style={{ width: 130 }}>Quantity</th><th style={{ width: 150 }}>Unit cost</th><th /></tr></thead><tbody>{lines.map((line, index) => <tr key={index}><td><select className="input" value={line.productId} onChange={(e) => setLines((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, productId: e.target.value } : item))}><option value="">Select product…</option>{products.data?.items.map((product) => <option key={product.id} value={product.id}>{product.name} ({product.sku})</option>)}</select></td><td><Input type="number" min={0} step="any" value={line.quantity} onChange={(e) => setLines((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: e.target.value } : item))} /></td><td><Input type="number" min={0} step="any" value={line.unitCost} onChange={(e) => setLines((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, unitCost: e.target.value } : item))} /></td><td className="right"><Button size="sm" variant="ghost" onClick={() => setLines((previous) => previous.length > 1 ? previous.filter((_, itemIndex) => itemIndex !== index) : previous)}>Remove</Button></td></tr>)}</tbody></table></div>
        <Button variant="secondary" size="sm" onClick={() => setLines((previous) => [...previous, { productId: "", quantity: "", unitCost: "" }])}>Add line</Button>
        {create.isError && <div className="login-error">{(create.error as Error).message}</div>}
      </Modal>
      <Modal title="Pay supplier invoice" open={Boolean(paymentInvoice)} onClose={() => setPaymentInvoice(null)} footer={<><Button variant="secondary" onClick={() => setPaymentInvoice(null)}>Cancel</Button><Button disabled={payment.isPending || !paymentAmount || parseFloat(paymentAmount) <= 0} onClick={() => payment.mutate()}>{payment.isPending ? "Posting…" : "Post payment"}</Button></>}>
        <div className="stack"><div className="total-row"><span>Invoice</span><span>{paymentInvoice?.reference}</span></div><div className="total-row grand"><span>Outstanding</span><span>{fmtMoney(paymentInvoice?.totals?.outstandingBalance ?? 0)}</span></div><Field label="Payment amount *"><Input type="number" min={0} max={paymentInvoice?.totals?.outstandingBalance ?? undefined} step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} /></Field><Field label="Payment method"><select className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}><option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option><option value="MOBILE_MONEY">Mobile money</option></select></Field>{payment.isError && <div className="login-error">{(payment.error as Error).message}</div>}</div>
      </Modal>
    </div>
  );
}