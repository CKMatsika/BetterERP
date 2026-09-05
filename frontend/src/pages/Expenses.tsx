import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Page } from "../api/client";
import { Button, Card, Input, Field, Modal, Pagination, Spinner, EmptyState, StatusBadge, usePage } from "../components/ui";
import { fmtMoney, fmtDateTime } from "../lib/format";
import { useBranchOptions } from "../lib/org";

interface ExpenseRow {
  id: string;
  reference: string;
  expenseDate: string;
  description: string;
  totalAmount: number;
  currency: string;
  status: string;
  paymentMethod: string | null;
  expenseCategory: { name: string } | null;
  paidBy: { fullName: string } | null;
}
interface CategoryRow { id: string; name: string }

export default function Expenses() {
  const qc = useQueryClient();
  const { page, pageSize, setPage } = usePage();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const branchOpts = useBranchOptions();

  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [rate, setRate] = useState("1");
  const [expenseDate, setExpenseDate] = useState("");
  const [branchId, setBranchId] = useState("");

  const q = useQuery({
    queryKey: ["expenses", page, debounced],
    queryFn: () => api.get<Page<ExpenseRow>>("/api/expenses", { page, pageSize, search: debounced }),
  });
  const cats = useQuery({ queryKey: ["expense-categories"], queryFn: () => api.get<{ items: CategoryRow[] }>("/api/expenses/categories") });

  const create = useMutation({
    mutationFn: () =>
      api.post("/api/expenses", {
        categoryId: categoryId || undefined,
        description,
        amount: parseFloat(amount),
        taxAmount: undefined,
        currency,
        exchangeRate: parseFloat(rate) || 1,
        paymentMethod: paymentMethod || undefined,
        bankAccountId: undefined,
        paidById: undefined,
        expenseDate: expenseDate || undefined,
        branchId: branchId || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      setCreateOpen(false);
      setCategoryId(""); setDescription(""); setAmount(""); setPaymentMethod(""); setCurrency("USD"); setRate("1"); setExpenseDate(""); setBranchId("");
    },
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Expenses</h1>
          <div className="page-subtitle">Record and track business expenses.</div>
        </div>
        <div className="page-actions"><Button onClick={() => setCreateOpen(true)}>New expense</Button></div>
      </div>

      <Card>
        <div className="hstack mb-2">
          <Input placeholder="Search reference or description…" value={search} onChange={(e) => { setSearch(e.target.value); window.setTimeout(() => setDebounced(e.target.value), 400); }} style={{ maxWidth: 320 }} />
        </div>
        {q.isLoading ? <Spinner /> : q.data!.items.length === 0 ? <EmptyState text="No expenses." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Reference</th><th>Date</th><th>Description</th><th>Category</th><th className="num">Amount</th><th>Ccy</th><th>Payment</th><th>Status</th></tr></thead>
              <tbody>
                {q.data!.items.map((e) => (
                  <tr key={e.id}>
                    <td style={{ fontWeight: 600 }}>{e.reference}</td>
                    <td>{fmtDateTime(e.expenseDate)}</td>
                    <td>{e.description}</td>
                    <td>{e.expenseCategory?.name ?? "—"}</td>
                    <td className="num">{fmtMoney(e.totalAmount)}</td>
                    <td>{e.currency}</td>
                    <td>{e.paymentMethod ?? "—"}</td>
                    <td><StatusBadge status={e.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={pageSize} total={q.data?.total ?? 0} onPage={setPage} />
      </Card>

      <Modal
        title="New expense"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        className="modal-wide"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button disabled={create.isPending || !description || parseFloat(amount) <= 0} onClick={() => create.mutate()}>
              {create.isPending ? "Saving…" : "Save expense"}
            </Button>
          </>
        }
      >
        <div className="form-row">
          <Field label="Category">
            <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Uncategorised</option>
              {cats.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Amount *"><Input type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        </div>
        <Field label="Description *"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div className="form-row-3">
          <Field label="Payment method">
            <select className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="">Not specified</option>
              <option value="CASH">Cash</option>
              <option value="BANK">Bank transfer</option>
              <option value="MOBILE_MONEY">Mobile money</option>
              <option value="CARD">Card</option>
              <option value="CREDIT">Credit</option>
            </select>
          </Field>
          <Field label="Currency">
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="USD">USD</option><option value="ZIG">ZIG</option><option value="ZWL">ZWL</option>
            </select>
          </Field>
          <Field label="Exchange rate"><Input type="number" min={0} step="any" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
        </div>
        <div className="form-row">
          <Field label="Expense date"><Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} /></Field>
          <Field label="Branch">
            <select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">My branch</option>
              {branchOpts.data?.items.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        </div>
        {create.isError && <div className="login-error">{(create.error as Error).message}</div>}
      </Modal>
    </div>
  );
}