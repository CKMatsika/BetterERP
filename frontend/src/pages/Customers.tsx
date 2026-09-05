import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Page } from "../api/client";
import { Button, Card, Input, Field, Modal, Pagination, Spinner, EmptyState, StatusBadge, usePage } from "../components/ui";
import { fmtMoney } from "../lib/format";

interface CustomerListRow {
  id: string;
  code: string | null;
  name: string;
  customerType?: string;
  phone?: string | null;
  email?: string | null;
  status: string;
  totalBilled: number;
  totalPaid: number;
  outstandingAmount: number;
}

interface StatementRow { date: string; reference: string; type: string; debit: number; credit: number; balance: number }
interface CreditSale { id: string; reference: string; total: number; amountPaid: number; saleDate: string; status: string; isCredit: boolean }

export default function Customers() {
  const qc = useQueryClient();
  const { page, pageSize, setPage } = usePage();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [stmtId, setStmtId] = useState<string | null>(null);
  const [receiptCustomer, setReceiptCustomer] = useState<CustomerListRow | null>(null);
  const [receiptAmount, setReceiptAmount] = useState("");
  const [receiptMethod, setReceiptMethod] = useState("CASH");
  const [receiptInvoiceId, setReceiptInvoiceId] = useState("");

  const q = useQuery({
    queryKey: ["customers", page, search.trim()],
    queryFn: () => api.get<Page<CustomerListRow>>("/api/customers", { page, pageSize, search: search.trim() || undefined }),
  });
  const stmt = useQuery({
    queryKey: ["customer", "statement", stmtId],
    queryFn: () => api.get<{ customer: CustomerListRow; rows: StatementRow[]; closingBalance: number }>(`/api/customers/${stmtId}/statement`),
    enabled: Boolean(stmtId),
  });
  const creditSales = useQuery({
    queryKey: ["customer", "credit-sales", receiptCustomer?.id],
    queryFn: () => api.get<Page<CreditSale>>("/api/sales", { customerId: receiptCustomer?.id, page: 1, pageSize: 500 }),
    enabled: Boolean(receiptCustomer),
  });
  const selectedInvoice = creditSales.data?.items.find((sale) => sale.id === receiptInvoiceId && sale.isCredit && ["COMPLETED", "PARTIAL_RETURN"].includes(sale.status));
  const receiptLimit = selectedInvoice ? Math.max(0, selectedInvoice.total - selectedInvoice.amountPaid) : receiptCustomer?.outstandingAmount ?? 0;

  const createForm = useCreateForm();
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/api/customers", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      setCreateOpen(false);
      createForm.reset();
    },
  });
  const receipt = useMutation({
    mutationFn: () => api.post("/api/customers/receipts", { customerId: receiptCustomer?.id, invoiceId: receiptInvoiceId || undefined, amount: parseFloat(receiptAmount), paymentMethod: receiptMethod }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["customers"] }); qc.invalidateQueries({ queryKey: ["customer", "credit-sales"] }); setReceiptCustomer(null); setReceiptAmount(""); setReceiptMethod("CASH"); setReceiptInvoiceId(""); },
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Customers</h1>
          <div className="page-subtitle">Accounts, credit and balances.</div>
        </div>
        <div className="page-actions">
          <Button onClick={() => setCreateOpen(true)}>New customer</Button>
        </div>
      </div>

      <Card>
        <div className="hstack mb-2" style={{ padding: "2px 0 12px" }}>
          <Input placeholder="Search name, code or phone…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={{ maxWidth: 340 }} />
        </div>
        {q.isLoading ? <Spinner /> : q.data!.items.length === 0 ? <EmptyState text="No customers found." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Code</th><th>Type</th><th>Phone</th><th>Status</th><th className="num">Billed</th><th className="num">Paid</th><th className="num">Outstanding</th><th /></tr></thead>
              <tbody>
                {q.data!.items.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600 }}>{c.name}</td>
                    <td>{c.code ?? "—"}</td>
                    <td>{c.customerType ?? "—"}</td>
                    <td>{c.phone ?? "—"}</td>
                    <td><StatusBadge status={c.status} /></td>
                    <td className="num">{fmtMoney(c.totalBilled)}</td>
                    <td className="num">{fmtMoney(c.totalPaid)}</td>
                    <td className="num" style={{ color: c.outstandingAmount > 0 ? "#d97706" : undefined }}>{fmtMoney(c.outstandingAmount)}</td>
                    <td className="right"><Button size="sm" variant="secondary" onClick={() => setStmtId(c.id)}>Statement</Button>{c.outstandingAmount > 0 && <Button size="sm" onClick={() => { setReceiptCustomer(c); setReceiptAmount(String(c.outstandingAmount)); setReceiptInvoiceId(""); }}>Receive</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={pageSize} total={q.data?.total ?? 0} onPage={setPage} />
      </Card>

      <Modal
        title="New customer"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button disabled={create.isPending || !createForm.values.name} onClick={() => create.mutate(createForm.values)}>
              {create.isPending ? "Saving…" : "Create customer"}
            </Button>
          </>
        }
      >
        <div className="form-row">
          <Field label="Name *"><Input value={createForm.values.name} onChange={(e) => createForm.set("name", e.target.value)} /></Field>
          <Field label="Code"><Input value={createForm.values.code} onChange={(e) => createForm.set("code", e.target.value)} placeholder="Optional" /></Field>
        </div>
        <div className="form-row">
          <Field label="Type">
            <select className="input" value={createForm.values.customerType} onChange={(e) => createForm.set("customerType", e.target.value)}>
              <option value="">—</option>
              <option value="RETAIL">Retail</option>
              <option value="WHOLESALE">Wholesale</option>
              <option value="CONTRACT">Contract</option>
              <option value="CREDIT">Credit</option>
            </select>
          </Field>
          <Field label="Phone"><Input value={createForm.values.phone} onChange={(e) => createForm.set("phone", e.target.value)} /></Field>
        </div>
        <div className="form-row">
          <Field label="Email"><Input type="email" value={createForm.values.email} onChange={(e) => createForm.set("email", e.target.value)} /></Field>
          <Field label="Tax number"><Input value={createForm.values.taxNumber} onChange={(e) => createForm.set("taxNumber", e.target.value)} /></Field>
        </div>
        <Field label="Address"><Input value={createForm.values.address} onChange={(e) => createForm.set("address", e.target.value)} /></Field>
        <div className="form-row">
          <Field label="Payment terms"><Input value={createForm.values.paymentTerms} onChange={(e) => createForm.set("paymentTerms", e.target.value)} placeholder="e.g. NET 30" /></Field>
          <Field label="Credit limit"><Input type="number" min={0} value={createForm.values.creditLimit} onChange={(e) => createForm.set("creditLimit", e.target.value)} /></Field>
        </div>
        {create.isError && <div className="login-error">{(create.error as Error).message}</div>}
      </Modal>
      <Modal title="Receive customer payment" open={Boolean(receiptCustomer)} onClose={() => setReceiptCustomer(null)} footer={<><Button variant="secondary" onClick={() => setReceiptCustomer(null)}>Cancel</Button><Button disabled={receipt.isPending || !receiptAmount || parseFloat(receiptAmount) <= 0} onClick={() => receipt.mutate()}>{receipt.isPending ? "Posting…" : "Post receipt"}</Button></>}>
        <div className="stack"><div className="total-row"><span>Customer</span><span>{receiptCustomer?.name}</span></div><Field label="Apply to credit invoice"><select className="input" value={receiptInvoiceId} onChange={(e) => { const invoiceId = e.target.value; setReceiptInvoiceId(invoiceId); const invoice = creditSales.data?.items.find((sale) => sale.id === invoiceId); setReceiptAmount(invoice ? String(Math.max(0, invoice.total - invoice.amountPaid)) : String(receiptCustomer?.outstandingAmount ?? 0)); }}><option value="">Unallocated customer receipt</option>{creditSales.data?.items.filter((sale) => sale.isCredit && ["COMPLETED", "PARTIAL_RETURN"].includes(sale.status) && sale.total > sale.amountPaid).map((sale) => <option key={sale.id} value={sale.id}>{sale.reference} — outstanding {fmtMoney(sale.total - sale.amountPaid)}</option>)}</select></Field><div className="total-row grand"><span>Outstanding</span><span>{fmtMoney(receiptLimit)}</span></div><Field label="Amount *"><Input type="number" min={0} max={receiptLimit} step="0.01" value={receiptAmount} onChange={(e) => setReceiptAmount(e.target.value)} /></Field><Field label="Payment method"><select className="input" value={receiptMethod} onChange={(e) => setReceiptMethod(e.target.value)}><option value="CASH">Cash</option><option value="BANK">Bank</option><option value="BANK_TRANSFER">Bank transfer</option><option value="ECOCASH">EcoCash</option><option value="ONEMONEY">OneMoney</option><option value="ZIPIT">ZIPIT</option></select></Field>{receipt.isError && <div className="login-error">{(receipt.error as Error).message}</div>}</div>
      </Modal>

      <Modal
        title={stmt.data ? `Statement — ${stmt.data.customer.name}` : "Statement"}
        open={Boolean(stmtId)}
        onClose={() => setStmtId(null)}
        className="modal-wide"
      >
        {stmt.isLoading ? <Spinner /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Reference</th><th>Type</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
              <tbody>
                {stmt.data!.rows.map((r, i) => (
                  <tr key={i}>
                    <td>{new Date(r.date).toLocaleDateString()}</td>
                    <td>{r.reference}</td>
                    <td>{r.type}</td>
                    <td className="num">{r.debit ? fmtMoney(r.debit) : "—"}</td>
                    <td className="num">{r.credit ? fmtMoney(r.credit) : "—"}</td>
                    <td className="num">{fmtMoney(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="total-row grand"><span>Closing balance</span><span>{fmtMoney(stmt.data!.closingBalance)}</span></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function useCreateForm() {
  const [values, setValues] = useState<Record<string, string>>({ name: "" });
  const set = (k: string, v: string) => setValues((p) => ({ ...p, [k]: v }));
  const reset = () => setValues({ name: "" });
  return { values, set, reset };
}