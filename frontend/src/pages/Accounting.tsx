import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Page } from "../api/client";
import { Button, Card, Input, Pagination, Spinner, EmptyState, Badge, usePage } from "../components/ui";
import { fmtMoney, fmtDate } from "../lib/format";

type Tab = "tb" | "pnl" | "bs" | "journals";

interface TbRow { id: string; code: string; name: string; type: string; debit: number; credit: number; balance: number; isDebit: boolean }
interface PnlRow { id: string; code: string; name: string; amount: number }
interface Journal { id: string; entryNumber: string; entryDate: string; description: string; entryType: string; posted: boolean; totalDebit: number; totalCredit: number; lines?: Array<{ debit: number; credit: number; account: { code: string; name: string } }> }

export default function Accounting() {
  const [tab, setTab] = useState<Tab>("tb");
  const { page, pageSize, setPage } = usePage();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const tb = useQuery({
    queryKey: ["acct", "tb", from, to],
    queryFn: () => api.get<{ items: TbRow[]; totalDebit: number; totalCredit: number; isBalanced: boolean }>("/api/accounting/trial-balance", { from: from || undefined, to: to || undefined }),
    enabled: tab === "tb",
  });
  const pnl = useQuery({
    queryKey: ["acct", "pnl", from, to],
    queryFn: () => api.get<{ revenue: PnlRow[]; expenses: PnlRow[]; totalRevenue: number; totalExpenses: number; netIncome: number }>("/api/accounting/profit-and-loss", { from: from || undefined, to: to || undefined }),
    enabled: tab === "pnl",
  });
  const bs = useQuery({
    queryKey: ["acct", "bs", to],
    queryFn: () => api.get<{ assets: PnlRow[]; liabilities: PnlRow[]; equity: PnlRow[]; totalAssets: number; totalLiabilities: number; totalEquity: number }>("/api/accounting/balance-sheet", { asOf: to || undefined }),
    enabled: tab === "bs",
  });
  const journals = useQuery({
    queryKey: ["acct", "journals", page, from, to],
    queryFn: () => api.get<Page<Journal>>("/api/accounting/journals", { page, pageSize, from: from || undefined, to: to || undefined }),
    enabled: tab === "journals",
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Accounting</h1>
          <div className="page-subtitle">Trial balance, profit &amp; loss, balance sheet and journal entries.</div>
        </div>
      </div>

      <div className="hstack mb-2">
        {(["tb", "pnl", "bs", "journals"] as Tab[]).map((t) => (
          <Button key={t} variant={tab === t ? "primary" : "secondary"} size="sm" onClick={() => setTab(t)}>
            {t === "tb" ? "Trial Balance" : t === "pnl" ? "Profit & Loss" : t === "bs" ? "Balance Sheet" : "Journals"}
          </Button>
        ))}
      </div>

      <div style={{ marginBottom: 14 }}>
        <Card>
          <div className="hstack">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ maxWidth: 170 }} />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ maxWidth: 170 }} />
            <span className="muted" style={{ fontSize: 12.5 }}>Period filter</span>
          </div>
        </Card>
      </div>

      {tab === "tb" && (
        <Card>
          {tb.isLoading ? <Spinner /> : tb.data!.items.length === 0 ? <EmptyState text="No journal activity in this period." /> : (
            <>
              <div className="hstack mb-2">
                <Badge tone={tb.data!.isBalanced ? "green" : "red"}>{tb.data!.isBalanced ? "Balanced" : "NOT BALANCED"}</Badge>
                <span className="muted">Total debit: {fmtMoney(tb.data!.totalDebit)} — Total credit: {fmtMoney(tb.data!.totalCredit)}</span>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Code</th><th>Account</th><th>Type</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
                  <tbody>
                    {tb.data!.items.map((r) => (
                      <tr key={r.id}>
                        <td>{r.code}</td><td>{r.name}</td><td>{r.type}</td>
                        <td className="num">{r.debit ? fmtMoney(r.debit) : "—"}</td>
                        <td className="num">{r.credit ? fmtMoney(r.credit) : "—"}</td>
                        <td className="num">{fmtMoney(r.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      )}

      {tab === "pnl" && (
        <Card>
          {pnl.isLoading ? <Spinner /> : (
            <div className="stack">
              <Section title="Revenue" rows={pnl.data!.revenue} />
              <Section title="Expenses" rows={pnl.data!.expenses} invert />
              <div className="total-row grand" style={{ padding: "10px 4px" }}>
                <span>Net income {pnl.data!.netIncome < 0 ? "(loss)" : ""}</span>
                <span style={{ color: pnl.data!.netIncome >= 0 ? "#16a34a" : "#dc2626" }}>{fmtMoney(pnl.data!.netIncome)}</span>
              </div>
            </div>
          )}
        </Card>
      )}

      {tab === "bs" && (
        <Card>
          {bs.isLoading ? <Spinner /> : (
            <div className="grid grid-3" style={{ alignItems: "start" }}>
              <Section title="Assets" rows={bs.data!.assets} total={bs.data!.totalAssets} />
              <Section title="Liabilities" rows={bs.data!.liabilities} total={bs.data!.totalLiabilities} />
              <Section title="Equity" rows={bs.data!.equity} total={bs.data!.totalEquity} />
            </div>
          )}
        </Card>
      )}

      {tab === "journals" && (
        <Card>
          {journals.isLoading ? <Spinner /> : journals.data!.items.length === 0 ? <EmptyState text="No journal entries." /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Number</th><th>Date</th><th>Description</th><th>Type</th><th className="num">Debit</th><th className="num">Credit</th><th>Posted</th></tr></thead>
                <tbody>
                  {journals.data!.items.map((j) => (
                    <tr key={j.id}>
                      <td style={{ fontWeight: 600 }}>{j.entryNumber}</td>
                      <td>{fmtDate(j.entryDate)}</td>
                      <td>{j.description}</td>
                      <td>{j.entryType}</td>
                      <td className="num">{fmtMoney(j.totalDebit)}</td>
                      <td className="num">{fmtMoney(j.totalCredit)}</td>
                      <td><Badge tone={j.posted ? "green" : "amber"}>{j.posted ? "POSTED" : "DRAFT"}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} pageSize={pageSize} total={journals.data?.total ?? 0} onPage={setPage} />
        </Card>
      )}
    </div>
  );
}

function Section({ title, rows, invert, total }: { title: string; rows: PnlRow[]; invert?: boolean; total?: number }) {
  if (rows.length === 0 && total === undefined) return <Card title={title}><EmptyState text="No activity." /></Card>;
  return (
    <Card title={title}>
      {rows.length === 0 ? <EmptyState text="No activity." /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Code</th><th>Account</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.code}</td><td>{r.name}</td>
                  <td className="num">{fmtMoney(invert ? Math.abs(r.amount) : r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total !== undefined && <div className="total-row grand"><span>{title} total</span><span>{fmtMoney(total)}</span></div>}
    </Card>
  );
}