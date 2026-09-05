import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type Page } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Card, Field, Input, Modal, Pagination, Spinner, EmptyState, StatusBadge, Button, Badge, usePage } from "../components/ui";
import { fmtMoney, fmtDateTime } from "../lib/format";

interface Sale {
  id: string;
  reference: string;
  type: string;
  status: string;
  total: number;
  taxAmount: number;
  amountPaid: number;
  saleDate: string;
  paymentMethod: string | null;
  isCredit: boolean;
  cashier: { id: string; fullName: string; username: string } | null;
  customer: { id: string; name: string } | null;
  branch: { id: string; name: string; code: string } | null;
  lines: Array<{ name?: unknown; product: { sku: string; name: string } | null; productId: string | null; description: string | null; quantity: number; unitPrice: number; lineTotal: number }>;
}

export default function Sales() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { page, pageSize, setPage } = usePage();
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [voidId, setVoidId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [returnSale, setReturnSale] = useState<Sale | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [refundMethod, setRefundMethod] = useState("CASH");
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({});

  const q = useQuery({
    queryKey: ["sales", page, search.trim(), customerId],
    queryFn: () => api.get<Page<Sale>>("/api/sales", { page, pageSize, search: search.trim() || undefined, customerId: customerId || undefined }),
  });

  const customers = useQuery({ queryKey: ["customers", "all"], queryFn: () => api.get<{ items: Array<{ id: string; name: string }> }>("/api/customers", { page: 1, pageSize: 500 }) });

  const doVoid = useMutation({
    mutationFn: () => api.post(`/api/sales/${voidId}/void`, { reason: voidReason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales"] });
      setVoidId(null);
      setVoidReason("");
    },
  });
  const doReturn = useMutation({
    mutationFn: () => api.post("/api/sales/returns", {
      saleId: returnSale?.id,
      customerId: returnSale?.customer?.id,
      refundMethod,
      reason: returnReason || undefined,
      lines: returnSale?.lines.flatMap((line) => {
        if (!line.productId) return [];
        const quantity = parseFloat(returnQuantities[line.productId] ?? "0");
        return quantity > 0 ? [{ productId: line.productId, quantity, unitPrice: line.unitPrice }] : [];
      }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sales"] }); setReturnSale(null); setReturnReason(""); setRefundMethod("CASH"); setReturnQuantities({}); },
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Sales</h1>
          <div className="page-subtitle">All sales transactions across your branch.</div>
        </div>
        <div className="page-actions">
          <Link className="btn btn-primary" to="/pos">Open POS</Link>
        </div>
      </div>

      <Card>
        <div className="hstack mb-2" style={{ padding: "2px 0 12px" }}>
          <Input placeholder="Search reference or customer…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={{ maxWidth: 340 }} />
          <select className="input" style={{ maxWidth: 260 }} value={customerId} onChange={(e) => { setCustomerId(e.target.value); setPage(1); }}>
            <option value="">All customers</option>
            {customers.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {q.isLoading ? <Spinner /> : q.isError ? <EmptyState text="Failed to load sales." /> : q.data!.items.length === 0 ? (
          <EmptyState text="No sales yet." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Reference</th><th>Date</th><th>Branch</th><th>Cashier</th><th>Customer</th><th>Type</th><th>Status</th><th className="num">Total</th><th className="num">Paid</th><th /></tr></thead>
              <tbody>
                {q.data!.items.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.reference}</td>
                    <td>{fmtDateTime(s.saleDate)}</td>
                    <td>{s.branch?.code ?? "—"}</td>
                    <td>{s.cashier?.fullName ?? "—"}</td>
                    <td>{s.customer?.name ?? "—"}</td>
                    <td>{s.type}</td>
                    <td>{s.isCredit ? <Badge tone="blue">CREDIT</Badge> : <StatusBadge status={s.status} />}</td>
                    <td className="num">{fmtMoney(s.total)}</td>
                    <td className="num">{fmtMoney(s.amountPaid)}</td>
                    <td className="right">
                      {s.status === "COMPLETED" && user?.permissions.includes("sale.void") && (
                        <Button size="sm" variant="secondary" onClick={() => setVoidId(s.id)}>Void</Button>
                      )}
                      {["COMPLETED", "PARTIAL_RETURN"].includes(s.status) && user?.permissions.includes("sale.refund") && (
                        <Button size="sm" variant="danger" onClick={() => setReturnSale(s)}>Return</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={pageSize} total={q.data?.total ?? 0} onPage={setPage} />
      </Card>

      {voidId && (
        <div className="modal-backdrop" onMouseDown={() => setVoidId(null)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-header"><div className="modal-title">Void sale</div>
              <Button variant="ghost" className="icon-btn" onClick={() => setVoidId(null)}>✕</Button>
            </div>
            <div className="modal-body">
              <p style={{ marginTop: 0 }}>This will reverse the sale and the accounting posting. Provide a reason.</p>
              <label className="field"><span className="field-label">Reason</span>
                <input className="input" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. customer returned goods" />
              </label>
              {doVoid.isError && <div className="login-error">{(doVoid.error as Error).message}</div>}
            </div>
            <div className="modal-footer">
              <Button variant="secondary" onClick={() => setVoidId(null)}>Cancel</Button>
              <Button variant="danger" disabled={doVoid.isPending || !voidReason.trim()} onClick={() => doVoid.mutate()}>
                {doVoid.isPending ? "Voiding…" : "Void sale"}
              </Button>
            </div>
          </div>
        </div>
      )}
      <Modal title={`Return sale ${returnSale?.reference ?? ""}`} open={Boolean(returnSale)} onClose={() => setReturnSale(null)} className="modal-wide" footer={<><Button variant="secondary" onClick={() => setReturnSale(null)}>Cancel</Button><Button variant="danger" disabled={doReturn.isPending || !returnSale || !returnSale.lines.some((line) => line.productId && parseFloat(returnQuantities[line.productId]) > 0)} onClick={() => doReturn.mutate()}>{doReturn.isPending ? "Posting…" : "Post return"}</Button></>}>
        <div className="form-row"><Field label="Refund method"><select className="input" value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}><option value="CASH">Cash</option><option value="BANK">Bank</option><option value="CREDIT">Customer credit</option></select></Field><Field label="Reason"><Input value={returnReason} onChange={(e) => setReturnReason(e.target.value)} /></Field></div>
        <div className="table-wrap"><table className="table"><thead><tr><th>Product</th><th className="num">Sold</th><th className="num">Return qty</th><th className="num">Unit price</th></tr></thead><tbody>{returnSale?.lines.filter((line) => line.productId).map((line) => <tr key={line.productId}><td>{line.product?.name ?? line.description ?? "Product"}<div className="muted">{line.product?.sku ?? ""}</div></td><td className="num">{line.quantity}</td><td className="num"><Input type="number" min={0} max={Number(line.quantity)} step="any" value={line.productId ? returnQuantities[line.productId] ?? "" : ""} onChange={(e) => line.productId && setReturnQuantities((previous) => ({ ...previous, [line.productId!]: e.target.value }))} style={{ maxWidth: 120, marginLeft: "auto" }} /></td><td className="num">{fmtMoney(line.unitPrice)}</td></tr>)}</tbody></table></div>
        {doReturn.isError && <div className="login-error">{(doReturn.error as Error).message}</div>}
      </Modal>
    </div>
  );
}