import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Page } from "../api/client";
import { Button, Card, Field, Input, Modal, Spinner, EmptyState, Badge } from "../components/ui";
import { fmtMoney, fmtDate } from "../lib/format";

interface BankAccount { id: string; accountName: string; bankName: string; accountNumber: string; currency: string; openingBalance: number; isDefault: boolean; account: { code: string; name: string } | null }
interface BankTransaction { id: string; transactionDate: string; description: string; reference: string | null; withdrawal: number; deposit: number; balance: number; reconciled: boolean }
interface ReconciliationStatus { lastReconciliation: { statementDate: string; statementBalance: number; difference: number } | null; unreconciledCount: number; bookBalance: number; unreconciledTransactions: BankTransaction[] }

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { values.push(value.trim()); value = ""; }
    else value += char;
  }
  values.push(value.trim());
  return values;
}

function parseStatementCsv(text: string) {
  const rows = text.split(/\r?\n/).filter((row) => row.trim());
  if (rows.length < 2) throw new Error("CSV must include a header and at least one transaction row");
  const headers = parseCsvLine(rows[0]).map((header) => header.toLowerCase());
  const index = (name: string) => headers.indexOf(name);
  if (index("transactiondate") < 0 || index("description") < 0) throw new Error("CSV headers must include transactionDate and description");
  return rows.slice(1).map((row) => {
    const values = parseCsvLine(row);
    const get = (name: string) => { const position = index(name); return position >= 0 ? values[position] ?? "" : ""; };
    return { transactionDate: get("transactiondate"), description: get("description"), reference: get("reference") || undefined, deposit: Number(get("deposit") || 0), withdrawal: Number(get("withdrawal") || 0) };
  });
}

export default function Banking() {
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [statementDate, setStatementDate] = useState("");
  const [statementBalance, setStatementBalance] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [accountName, setAccountName] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const accounts = useQuery({ queryKey: ["bank-accounts"], queryFn: () => api.get<{ items: BankAccount[] }>("/api/banking/accounts") });
  const selectedAccount = accounts.data?.items.find((account) => account.id === accountId);
  const status = useQuery({
    queryKey: ["bank-reconciliation", accountId],
    queryFn: () => api.get<ReconciliationStatus>(`/api/banking/accounts/${accountId}/reconciliation-status`),
    enabled: Boolean(accountId),
  });
  const transactions = useQuery({
    queryKey: ["bank-transactions", accountId],
    queryFn: () => api.get<Page<BankTransaction>>(`/api/banking/accounts/${accountId}/transactions`, { page: 1, pageSize: 100, reconciled: false }),
    enabled: Boolean(accountId),
  });
  const create = useMutation({
    mutationFn: () => api.post("/api/banking/accounts", { accountName, bankName, accountNumber, currency }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bank-accounts"] }); setCreateOpen(false); setAccountName(""); setBankName(""); setAccountNumber(""); setCurrency("USD"); },
  });
  const reconcile = useMutation({
    mutationFn: () => api.post(`/api/banking/accounts/${accountId}/reconcile`, { statementDate, statementBalance: parseFloat(statementBalance), reconciledTxIds: selected }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bank-reconciliation", accountId] }); qc.invalidateQueries({ queryKey: ["bank-transactions", accountId] }); setSelected([]); },
  });
  const importStatement = useMutation({
    mutationFn: (transactions: ReturnType<typeof parseStatementCsv>) => api.post<{ imported: number; skipped: number }>(`/api/banking/accounts/${accountId}/import`, { transactions }),
    onSuccess: (result) => { qc.invalidateQueries({ queryKey: ["bank-reconciliation", accountId] }); qc.invalidateQueries({ queryKey: ["bank-transactions", accountId] }); setImportMessage(`Imported ${result.imported} row(s); skipped ${result.skipped} duplicate(s).`); },
  });

  const toggle = (id: string) => setSelected((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]);
  const rows = status.data?.unreconciledTransactions ?? transactions.data?.items ?? [];

  return <div>
    <div className="page-header"><div><h1 className="page-title">Banking</h1><div className="page-subtitle">Manage bank accounts and reconcile statement transactions.</div></div><div className="page-actions"><Button onClick={() => setCreateOpen(true)}>Add bank account</Button></div></div>
    <div className="form-row mb-2"><Field label="Bank account"><select className="input" value={accountId} onChange={(e) => { setAccountId(e.target.value); setSelected([]); }}><option value="">Select account…</option>{accounts.data?.items.map((account) => <option key={account.id} value={account.id}>{account.accountName} — {account.bankName} ({account.currency})</option>)}</select></Field></div>
    {!accountId ? <Card><EmptyState text="Select a bank account to view unreconciled transactions." /></Card> : <>
      <div className="grid grid-3"><Card title="Book balance"><div className="stat-value">{fmtMoney(status.data?.bookBalance ?? 0)}</div></Card><Card title="Statement balance"><div className="stat-value">{fmtMoney(status.data?.lastReconciliation?.statementBalance ?? 0)}</div></Card><Card title="Unreconciled"><div className="stat-value">{status.data?.unreconciledCount ?? rows.length}</div></Card></div>
      <Card title={`Unreconciled transactions — ${selectedAccount?.accountName ?? ""}`}>
        <div className="hstack mb-2"><label className="btn btn-secondary"><span>Import CSV</span><input type="file" accept=".csv,text/csv" hidden disabled={!accountId || importStatement.isPending} onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; setImportMessage(null); void file.text().then((text) => importStatement.mutate(parseStatementCsv(text))).catch((error: unknown) => setImportMessage(error instanceof Error ? error.message : "Could not import CSV")); event.target.value = ""; }} /></label><span className="muted">Headers: transactionDate, description, reference, deposit, withdrawal</span></div>
        {importMessage && <div className="login-error" style={{ color: "var(--success)" }}>{importMessage}</div>}
        {status.isLoading ? <Spinner /> : rows.length === 0 ? <EmptyState text="No unreconciled transactions." /> : <div className="table-wrap"><table className="table"><thead><tr><th /><th>Date</th><th>Description</th><th>Reference</th><th className="num">Deposit</th><th className="num">Withdrawal</th><th className="num">Balance</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><input type="checkbox" checked={selected.includes(row.id)} onChange={() => toggle(row.id)} /></td><td>{fmtDate(row.transactionDate)}</td><td>{row.description}</td><td>{row.reference ?? "—"}</td><td className="num">{row.deposit ? fmtMoney(row.deposit) : "—"}</td><td className="num">{row.withdrawal ? fmtMoney(row.withdrawal) : "—"}</td><td className="num">{fmtMoney(row.balance)}</td></tr>)}</tbody></table></div>}
      </Card>
      <Card title="Complete reconciliation" style={{ marginTop: 16 }}><div className="form-row"><Field label="Statement date *"><Input type="date" value={statementDate} onChange={(e) => setStatementDate(e.target.value)} /></Field><Field label="Statement closing balance *"><Input type="number" step="0.01" value={statementBalance} onChange={(e) => setStatementBalance(e.target.value)} /></Field><div className="field"><span className="field-label">Selected</span><Badge tone="blue">{selected.length} transaction(s)</Badge></div></div><Button disabled={reconcile.isPending || !statementDate || !statementBalance || selected.length === 0} onClick={() => reconcile.mutate()}>{reconcile.isPending ? "Reconciling…" : "Complete reconciliation"}</Button>{reconcile.isError && <div className="login-error">{(reconcile.error as Error).message}</div>}</Card>
    </>}
    <Modal title="Add bank account" open={createOpen} onClose={() => setCreateOpen(false)} footer={<><Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button><Button disabled={create.isPending || !accountName || !bankName || !accountNumber} onClick={() => create.mutate()}>{create.isPending ? "Saving…" : "Save account"}</Button></>}><div className="form-row"><Field label="Account name *"><Input value={accountName} onChange={(e) => setAccountName(e.target.value)} /></Field><Field label="Bank name *"><Input value={bankName} onChange={(e) => setBankName(e.target.value)} /></Field></div><div className="form-row"><Field label="Account number *"><Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} /></Field><Field label="Currency"><select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}><option value="USD">USD</option><option value="ZIG">ZiG</option><option value="ZWL">ZWL</option></select></Field></div>{create.isError && <div className="login-error">{(create.error as Error).message}</div>}</Modal>
  </div>;
}
