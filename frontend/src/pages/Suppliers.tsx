import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Page } from "../api/client";
import { Button, Card, Field, Input, Modal, Pagination, Spinner, EmptyState, Badge, usePage } from "../components/ui";
import { useBranchOptions } from "../lib/org";

interface SupplierRow {
  id: string;
  code: string | null;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  currency: string;
  status: string;
  outstandingBalance: number;
  _count: { purchaseOrders: number; invoices: number };
}

export default function Suppliers() {
  const qc = useQueryClient();
  const { page, pageSize, setPage } = usePage();
  const branches = useBranchOptions();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [branchId, setBranchId] = useState("");

  const q = useQuery({
    queryKey: ["suppliers", page, search.trim()],
    queryFn: () => api.get<Page<SupplierRow>>("/api/procurement/suppliers", { page, pageSize, search: search.trim() || undefined }),
  });
  const create = useMutation({
    mutationFn: () => api.post("/api/procurement/suppliers", {
      name, code: code || undefined, contactPerson: contactPerson || undefined,
      phone: phone || undefined, email: email || undefined, currency,
      branchId: branchId || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      setOpen(false); setName(""); setCode(""); setContactPerson(""); setPhone(""); setEmail(""); setCurrency("USD"); setBranchId("");
    },
  });

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Suppliers</h1><div className="page-subtitle">Supplier master data and payable exposure.</div></div><div className="page-actions"><Button onClick={() => setOpen(true)}>New supplier</Button></div></div>
      <Card>
        <div className="hstack mb-2"><Input placeholder="Search suppliers…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={{ maxWidth: 340 }} /></div>
        {q.isLoading ? <Spinner /> : q.data?.items.length === 0 ? <EmptyState text="No suppliers yet." /> : <div className="table-wrap"><table className="table">
          <thead><tr><th>Code</th><th>Supplier</th><th>Contact</th><th>Currency</th><th className="num">Outstanding</th><th>Orders</th><th>Invoices</th><th>Status</th></tr></thead>
          <tbody>{q.data?.items.map((supplier) => <tr key={supplier.id}><td style={{ fontWeight: 600 }}>{supplier.code ?? "—"}</td><td>{supplier.name}</td><td>{supplier.contactPerson ?? supplier.phone ?? "—"}</td><td>{supplier.currency}</td><td className="num">{supplier.outstandingBalance.toFixed(2)}</td><td>{supplier._count.purchaseOrders}</td><td>{supplier._count.invoices}</td><td><Badge tone={supplier.status === "ACTIVE" ? "green" : "gray"}>{supplier.status}</Badge></td></tr>)}</tbody>
        </table></div>}
        <Pagination page={page} pageSize={pageSize} total={q.data?.total ?? 0} onPage={setPage} />
      </Card>
      <Modal title="New supplier" open={open} onClose={() => setOpen(false)} footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={create.isPending || !name} onClick={() => create.mutate()}>{create.isPending ? "Saving…" : "Save supplier"}</Button></>}>
        <div className="form-row"><Field label="Supplier name *"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field><Field label="Code"><Input value={code} onChange={(e) => setCode(e.target.value)} /></Field></div>
        <div className="form-row"><Field label="Contact person"><Input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} /></Field><Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field></div>
        <div className="form-row-3"><Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field><Field label="Currency"><select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}><option value="USD">USD</option><option value="ZIG">ZiG</option><option value="ZWL">ZWL</option></select></Field><Field label="Branch"><select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="">My branch</option>{branches.data?.items.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field></div>
        {create.isError && <div className="login-error">{(create.error as Error).message}</div>}
      </Modal>
    </div>
  );
}
