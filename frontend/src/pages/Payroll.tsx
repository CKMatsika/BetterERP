import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Page } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Input, Field, Modal, Pagination, Spinner, EmptyState, StatusBadge, Badge, usePage } from "../components/ui";
import { fmtMoney, fmtDate } from "../lib/format";
import { useBranchOptions } from "../lib/org";

interface PayrollRow {
  id: string;
  reference: string;
  periodName: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  status: string;
  currency: string;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  totalTax: number;
  posted: boolean;
  lines: Array<{ employee: { employeeNumber: string; firstName: string; lastName: string }; netPay: number; grossPay: number }>;
}

export default function Payroll() {
  const qc = useQueryClient();
  const { page, pageSize, setPage } = usePage();
  const { user } = useAuth();
  const [runOpen, setRunOpen] = useState(false);
  const branchOpts = useBranchOptions();

  const [periodName, setPeriodName] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [payDate, setPayDate] = useState("");
  const [branchId, setBranchId] = useState("");

  const q = useQuery({
    queryKey: ["payroll", page],
    queryFn: () => api.get<Page<PayrollRow>>("/api/payroll/runs", { page, pageSize }),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post("/api/payroll/runs", {
        periodName, periodStart, periodEnd, payDate,
        branchId: branchId || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll"] });
      setRunOpen(false);
      setPeriodName(""); setPeriodStart(""); setPeriodEnd(""); setPayDate(""); setBranchId("");
    },
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "post" }) => api.post(`/api/payroll/runs/${id}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll"] }),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Payroll</h1>
          <div className="page-subtitle">Run payroll, approve and post to the general ledger.</div>
        </div>
        <div className="page-actions"><Button onClick={() => setRunOpen(true)}>Run payroll</Button></div>
      </div>

      <Card>
        {q.isLoading ? <Spinner /> : q.data!.items.length === 0 ? <EmptyState text="No payroll runs yet." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Reference</th><th>Period</th><th>Pay date</th><th className="num">Gross</th><th className="num">Deductions</th><th className="num">Net</th><th>Employees</th><th>Status</th><th /></tr></thead>
              <tbody>
                {q.data!.items.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.reference}</td>
                    <td>{p.periodName} ({fmtDate(p.periodStart)} → {fmtDate(p.periodEnd)})</td>
                    <td>{fmtDate(p.payDate)}</td>
                    <td className="num">{fmtMoney(p.totalGross)}</td>
                    <td className="num">{fmtMoney(p.totalDeductions)}</td>
                    <td className="num"><Badge tone="green">{fmtMoney(p.totalNet)}</Badge></td>
                    <td>{p.lines.length}</td>
                    <td>
                      <StatusBadge status={p.status} />{p.posted && <Badge tone="blue">POSTED</Badge>}
                    </td>
                    <td className="right">
                      {p.status === "DRAFT" && user?.permissions.includes("payroll.approve") && <Button size="sm" variant="secondary" onClick={() => act.mutate({ id: p.id, action: "approve" })}>Approve</Button>}
                      {p.status === "APPROVED" && user?.permissions.includes("payroll.post") && !p.posted && <Button size="sm" onClick={() => act.mutate({ id: p.id, action: "post" })}>Post to GL</Button>}
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
        title="Run payroll"
        open={runOpen}
        onClose={() => setRunOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRunOpen(false)}>Cancel</Button>
            <Button disabled={create.isPending || !periodName || !periodStart || !periodEnd || !payDate} onClick={() => create.mutate()}>
              {create.isPending ? "Running…" : "Run payroll"}
            </Button>
          </>
        }
      >
        <Field label="Period name *"><Input value={periodName} onChange={(e) => setPeriodName(e.target.value)} placeholder="e.g. September 2026" /></Field>
        <div className="form-row-3">
          <Field label="Period start *"><Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} /></Field>
          <Field label="Period end *"><Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></Field>
          <Field label="Pay date *"><Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></Field>
        </div>
        <Field label="Branch">
          <select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">My branch</option>
            {branchOpts.data?.items.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <div className="muted" style={{ fontSize: 12.5 }}>Runs for all active employees in the branch. Deducts NSSA, PAID levy and PAYE automatically.</div>
        {create.isError && <div className="login-error">{(create.error as Error).message}</div>}
      </Modal>
    </div>
  );
}