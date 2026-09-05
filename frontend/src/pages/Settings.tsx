import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Button, Card, Field, Input, Spinner, EmptyState, Modal, Badge } from "../components/ui";

interface SettingRow { id: string; group: string; key: string; value: string; dataType: string; isPublic: boolean }
interface CurrencyRow { id: string; code: string; name: string; symbol: string; isBase: boolean; isActive: boolean; exchangeRates: Array<{ id: string; rateToBase: number; effectiveDate: string }> }
interface CompanyProfile { id: string; name: string; legalName: string | null; registrationNumber: string | null; vatNumber: string | null; address: string | null; city: string | null; country: string; phone: string | null; email: string | null; website: string | null; logoUrl: string | null; settings: { primaryColor?: string; accentColor?: string } | null }
interface BranchRow { id: string; code: string; name: string; type: string; address: string | null; city: string | null; phone: string | null; email: string | null; status: string; warehouses: Array<{ id: string; code: string; name: string; isDefault: boolean }> }

const GROUPS = ["POS", "INVENTORY", "GENERAL", "CURRENCY", "VAT", "TAX", "NOTIFICATIONS", "SECURITY"];

export default function Settings() {
  const qc = useQueryClient();
  const [group, setGroup] = useState("GENERAL");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [wizardOpen, setWizardOpen] = useState(false);
  const [rateCurrencyId, setRateCurrencyId] = useState("");
  const [rateValue, setRateValue] = useState("");
  const [rateDate, setRateDate] = useState("");
  const [companyEdits, setCompanyEdits] = useState<Partial<CompanyProfile>>({});
  const [branchOpen, setBranchOpen] = useState(false);
  const [warehouseOpen, setWarehouseOpen] = useState<BranchRow | null>(null);
  const [branchForm, setBranchForm] = useState({ code: "", name: "", type: "BRANCH", address: "", city: "", phone: "", email: "" });
  const [warehouseForm, setWarehouseForm] = useState({ code: "", name: "", address: "" });

  const q = useQuery({
    queryKey: ["settings", group],
    queryFn: () => api.get<{ items: SettingRow[] }>(`/api/settings/${group}`),
  });
  const workflows = useQuery({
    queryKey: ["approval-workflows"],
    queryFn: () => api.get<{ items: Array<{ id: string; name: string; entityType: string; levels: Array<{ level: number; role: { name: string } | null }> }> }>("/api/settings/approval-workflows"),
  });
  const currencies = useQuery({ queryKey: ["settings", "currencies"], queryFn: () => api.get<{ items: CurrencyRow[] }>("/api/tax/currencies") });
  const company = useQuery({ queryKey: ["company", "profile"], queryFn: () => api.get<CompanyProfile>("/api/company/profile") });
  const branches = useQuery({ queryKey: ["settings", "branches"], queryFn: () => api.get<{ items: BranchRow[] }>("/api/branches", { details: true }) });
  useEffect(() => { if (company.data) setCompanyEdits(company.data); }, [company.data]);
  const saveCompany = useMutation({ mutationFn: () => api.put("/api/company/profile", { ...companyEdits, settings: { ...(company.data?.settings ?? {}), primaryColor: companyEdits.settings?.primaryColor, accentColor: companyEdits.settings?.accentColor } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["company", "profile"] }) });
  const createBranch = useMutation({ mutationFn: () => api.post("/api/branches", branchForm), onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings", "branches"] }); setBranchOpen(false); setBranchForm({ code: "", name: "", type: "BRANCH", address: "", city: "", phone: "", email: "" }); } });
  const createWarehouse = useMutation({ mutationFn: () => api.post(`/api/branches/${warehouseOpen?.id}/warehouses`, warehouseForm), onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings", "branches"] }); setWarehouseOpen(null); setWarehouseForm({ code: "", name: "", address: "" }); } });
  const saveRate = useMutation({
    mutationFn: () => api.post(`/api/tax/currencies/${rateCurrencyId}/exchange-rates`, { rateToBase: parseFloat(rateValue), effectiveDate: rateDate || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings", "currencies"] }); qc.invalidateQueries({ queryKey: ["pos", "currencies"] }); setRateValue(""); setRateDate(""); },
  });

  useEffect(() => {
    if (q.data) setEdits(Object.fromEntries(q.data.items.map((s) => [s.id, s.value])));
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => {
      const items = (q.data?.items ?? []).filter((s) => edits[s.id] !== s.value);
      return api.put("/api/settings", { settings: items.map((s) => ({ group: s.group, key: s.key, value: edits[s.id], dataType: s.dataType })) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["pos"] });
    },
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <div className="page-subtitle">Company-wide configuration.</div>
        </div>
        <div className="page-actions"><Button onClick={() => setWizardOpen(true)}>Company wizard</Button></div>
      </div>

      <div className="hstack mb-2" style={{ flexWrap: "wrap", gap: 8 }}>
        {GROUPS.map((g) => (
          <Button key={g} size="sm" variant={group === g ? "primary" : "secondary"} onClick={() => setGroup(g)}>{g}</Button>
        ))}
      </div>

      <Card title="Company profile and branding" actions={<Button disabled={saveCompany.isPending} onClick={() => saveCompany.mutate()}>{saveCompany.isPending ? "Saving…" : "Save company profile"}</Button>}>
        {company.isLoading ? <Spinner /> : <div className="form-row-3"><Field label="Company name"><Input value={companyEdits.name ?? ""} onChange={(e) => setCompanyEdits((p) => ({ ...p, name: e.target.value }))} /></Field><Field label="Legal name"><Input value={companyEdits.legalName ?? ""} onChange={(e) => setCompanyEdits((p) => ({ ...p, legalName: e.target.value }))} /></Field><Field label="Registration number"><Input value={companyEdits.registrationNumber ?? ""} onChange={(e) => setCompanyEdits((p) => ({ ...p, registrationNumber: e.target.value }))} /></Field><Field label="VAT number"><Input value={companyEdits.vatNumber ?? ""} onChange={(e) => setCompanyEdits((p) => ({ ...p, vatNumber: e.target.value }))} /></Field><Field label="Phone"><Input value={companyEdits.phone ?? ""} onChange={(e) => setCompanyEdits((p) => ({ ...p, phone: e.target.value }))} /></Field><Field label="Email"><Input type="email" value={companyEdits.email ?? ""} onChange={(e) => setCompanyEdits((p) => ({ ...p, email: e.target.value }))} /></Field><Field label="Address"><Input value={companyEdits.address ?? ""} onChange={(e) => setCompanyEdits((p) => ({ ...p, address: e.target.value }))} /></Field><Field label="City"><Input value={companyEdits.city ?? ""} onChange={(e) => setCompanyEdits((p) => ({ ...p, city: e.target.value }))} /></Field><Field label="Logo URL"><Input value={companyEdits.logoUrl ?? ""} onChange={(e) => setCompanyEdits((p) => ({ ...p, logoUrl: e.target.value }))} placeholder="https://…" /></Field><Field label="Primary colour"><Input type="color" value={companyEdits.settings?.primaryColor ?? "#2563eb"} onChange={(e) => setCompanyEdits((p) => ({ ...p, settings: { ...(p.settings ?? {}), primaryColor: e.target.value } }))} /></Field><Field label="Accent colour"><Input type="color" value={companyEdits.settings?.accentColor ?? "#0f766e"} onChange={(e) => setCompanyEdits((p) => ({ ...p, settings: { ...(p.settings ?? {}), accentColor: e.target.value } }))} /></Field></div>}
        {saveCompany.isError && <div className="login-error">{(saveCompany.error as Error).message}</div>}
      </Card>

      <Card title="Branches and warehouses" actions={<Button onClick={() => setBranchOpen(true)}>Add branch</Button>} style={{ marginTop: 16 }}>
        {branches.isLoading ? <Spinner /> : branches.data?.items.length === 0 ? <EmptyState text="No branches configured." /> : <div className="table-wrap"><table className="table"><thead><tr><th>Code</th><th>Branch</th><th>Type</th><th>Address</th><th>Warehouses</th><th /></tr></thead><tbody>{branches.data?.items.map((branch) => <tr key={branch.id}><td style={{ fontWeight: 600 }}>{branch.code}</td><td>{branch.name}</td><td>{branch.type}</td><td>{branch.address ?? branch.city ?? "—"}</td><td>{branch.warehouses.map((warehouse) => warehouse.name).join(", ") || "—"}</td><td className="right"><Button size="sm" variant="secondary" onClick={() => setWarehouseOpen(branch)}>Add warehouse</Button></td></tr>)}</tbody></table></div>}
      </Card>

      <Card>
        {q.isLoading ? <Spinner /> : q.data!.items.length === 0 ? <EmptyState text="No settings in this group." /> : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Key</th><th>Value</th></tr></thead>
                <tbody>
                  {q.data!.items.map((s) => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 600 }}>{s.key}</td>
                      <td><Input value={edits[s.id] ?? ""} onChange={(e) => setEdits((prev) => ({ ...prev, [s.id]: e.target.value }))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="hstack" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save settings"}</Button>
            </div>
          </>
        )}
      </Card>

      <Card title="Approval workflows" style={{ marginTop: 16 }}>
        {workflows.isLoading ? <Spinner /> : workflows.data!.items.length === 0 ? <EmptyState text="No workflows configured." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Entity</th><th>Levels</th></tr></thead>
              <tbody>
                {workflows.data!.items.map((w) => (
                  <tr key={w.id}>
                    <td style={{ fontWeight: 600 }}>{w.name}</td>
                    <td>{w.entityType}</td>
                    <td>{w.levels.map((l) => `${l.level}. ${l.role?.name ?? "?"}`).join(" → ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Currencies and exchange rates" style={{ marginTop: 16 }}>
        {currencies.isLoading ? <Spinner /> : currencies.data?.items.length === 0 ? <EmptyState text="No currencies configured." /> : <>
          <div className="table-wrap"><table className="table"><thead><tr><th>Currency</th><th>Base</th><th className="num">Latest rate to USD</th><th>Effective</th></tr></thead><tbody>{currencies.data?.items.map((currency) => <tr key={currency.id}><td style={{ fontWeight: 600 }}>{currency.code} — {currency.name}</td><td>{currency.isBase ? <Badge tone="blue">BASE</Badge> : "—"}</td><td className="num">{currency.isBase ? "1.000000" : currency.exchangeRates[0]?.rateToBase ?? "Not set"}</td><td>{currency.exchangeRates[0]?.effectiveDate ? new Date(currency.exchangeRates[0].effectiveDate).toLocaleDateString() : "—"}</td></tr>)}</tbody></table></div>
          <div className="form-row" style={{ marginTop: 12 }}><Field label="Currency"><select className="input" value={rateCurrencyId} onChange={(e) => setRateCurrencyId(e.target.value)}><option value="">Select currency…</option>{currencies.data?.items.filter((currency) => !currency.isBase && currency.isActive).map((currency) => <option key={currency.id} value={currency.id}>{currency.code} — {currency.name}</option>)}</select></Field><Field label="Rate to USD"><Input type="number" min={0} step="0.000001" value={rateValue} onChange={(e) => setRateValue(e.target.value)} placeholder="e.g. 26.50" /></Field><Field label="Effective date"><Input type="date" value={rateDate} onChange={(e) => setRateDate(e.target.value)} /></Field><div className="field"><span className="field-label">&nbsp;</span><Button disabled={saveRate.isPending || !rateCurrencyId || parseFloat(rateValue) <= 0} onClick={() => saveRate.mutate()}>{saveRate.isPending ? "Saving…" : "Update rate"}</Button></div></div>
          {saveRate.isError && <div className="login-error">{(saveRate.error as Error).message}</div>}
        </>}
      </Card>

      <Modal title="Add branch" open={branchOpen} onClose={() => setBranchOpen(false)} footer={<><Button variant="secondary" onClick={() => setBranchOpen(false)}>Cancel</Button><Button disabled={createBranch.isPending || !branchForm.code || !branchForm.name} onClick={() => createBranch.mutate()}>{createBranch.isPending ? "Saving…" : "Create branch"}</Button></>}>
        <div className="form-row"><Field label="Code *"><Input value={branchForm.code} onChange={(e) => setBranchForm((p) => ({ ...p, code: e.target.value }))} /></Field><Field label="Name *"><Input value={branchForm.name} onChange={(e) => setBranchForm((p) => ({ ...p, name: e.target.value }))} /></Field></div><div className="form-row"><Field label="Type"><select className="input" value={branchForm.type} onChange={(e) => setBranchForm((p) => ({ ...p, type: e.target.value }))}><option value="BRANCH">Branch</option><option value="HQ">HQ</option><option value="WAREHOUSE_ONLY">Warehouse only</option></select></Field><Field label="City"><Input value={branchForm.city} onChange={(e) => setBranchForm((p) => ({ ...p, city: e.target.value }))} /></Field></div><Field label="Address"><Input value={branchForm.address} onChange={(e) => setBranchForm((p) => ({ ...p, address: e.target.value }))} /></Field><div className="form-row"><Field label="Phone"><Input value={branchForm.phone} onChange={(e) => setBranchForm((p) => ({ ...p, phone: e.target.value }))} /></Field><Field label="Email"><Input type="email" value={branchForm.email} onChange={(e) => setBranchForm((p) => ({ ...p, email: e.target.value }))} /></Field></div>{createBranch.isError && <div className="login-error">{(createBranch.error as Error).message}</div>}
      </Modal>
      <Modal title={`Add warehouse${warehouseOpen ? ` — ${warehouseOpen.name}` : ""}`} open={Boolean(warehouseOpen)} onClose={() => setWarehouseOpen(null)} footer={<><Button variant="secondary" onClick={() => setWarehouseOpen(null)}>Cancel</Button><Button disabled={createWarehouse.isPending || !warehouseForm.code || !warehouseForm.name} onClick={() => createWarehouse.mutate()}>{createWarehouse.isPending ? "Saving…" : "Create warehouse"}</Button></>}>
        <div className="form-row"><Field label="Code *"><Input value={warehouseForm.code} onChange={(e) => setWarehouseForm((p) => ({ ...p, code: e.target.value }))} /></Field><Field label="Name *"><Input value={warehouseForm.name} onChange={(e) => setWarehouseForm((p) => ({ ...p, name: e.target.value }))} /></Field></div><Field label="Address"><Input value={warehouseForm.address} onChange={(e) => setWarehouseForm((p) => ({ ...p, address: e.target.value }))} /></Field>{createWarehouse.isError && <div className="login-error">{(createWarehouse.error as Error).message}</div>}
      </Modal>

      <Modal title="Company setup wizard" open={wizardOpen} onClose={() => setWizardOpen(false)}>
        <div className="stack" style={{ gap: 10 }}>
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            This wizard walks through POS, inventory, VAT, currency and approval settings for a new company. Backend endpoints are ready under <code>/api/settings</code> — configure defaults for GOZ hardware retail here.
          </p>
          <Button variant="secondary" onClick={() => setGroup("POS")}>POS settings</Button>
          <Button variant="secondary" onClick={() => setGroup("VAT")}>VAT / tax settings</Button>
          <Button variant="secondary" onClick={() => setGroup("CURRENCY")}>Currency settings</Button>
          <Button variant="secondary" onClick={() => setGroup("SECURITY")}>Security settings</Button>
        </div>
      </Modal>
    </div>
  );
}