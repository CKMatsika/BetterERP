import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Page } from "../api/client";
import { Button, Card, Field, Input, Modal, Pagination, Spinner, EmptyState, StatusBadge, usePage } from "../components/ui";
import { fmtMoney, fmtDate } from "../lib/format";
import { useBranchOptions } from "../lib/org";

interface AssetRow {
  id: string;
  assetNumber: string;
  name: string;
  serialNumber: string | null;
  purchaseDate: string | null;
  purchaseCost: number;
  bookValue: number;
  status: string;
  category: { id: string; name: string } | null;
  assignedEmployee: { firstName: string; lastName: string } | null;
}
interface CategoryRow { id: string; name: string; depreciationRate: number; _count: { assets: number } }

export default function Assets() {
  const qc = useQueryClient();
  const { page, pageSize, setPage } = usePage();
  const branches = useBranchOptions();
  const [createOpen, setCreateOpen] = useState(false);
  const [disposeId, setDisposeId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchaseCost, setPurchaseCost] = useState("");
  const [usefulLifeYears, setUsefulLifeYears] = useState("5");
  const [branchId, setBranchId] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [disposalAmount, setDisposalAmount] = useState("");
  const [disposalDate, setDisposalDate] = useState("");
  const [disposalReason, setDisposalReason] = useState("");

  const assets = useQuery({
    queryKey: ["assets", page],
    queryFn: () => api.get<Page<AssetRow>>("/api/assets", { page, pageSize }),
  });
  const categories = useQuery({
    queryKey: ["asset-categories"],
    queryFn: () => api.get<{ items: CategoryRow[] }>("/api/assets/categories"),
  });
  const create = useMutation({
    mutationFn: () => api.post("/api/assets", {
      name, categoryId: categoryId || undefined, purchaseDate: purchaseDate || undefined,
      purchaseCost: parseFloat(purchaseCost), usefulLifeYears: parseInt(usefulLifeYears, 10) || undefined,
      branchId: branchId || undefined, serialNumber: serialNumber || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      setCreateOpen(false); setName(""); setCategoryId(""); setPurchaseDate(""); setPurchaseCost(""); setUsefulLifeYears("5"); setBranchId(""); setSerialNumber("");
    },
  });
  const dispose = useMutation({
    mutationFn: () => api.post(`/api/assets/${disposeId}/dispose`, {
      disposalDate: disposalDate || new Date().toISOString().slice(0, 10),
      disposalAmount: parseFloat(disposalAmount) || 0,
      reason: disposalReason || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      setDisposeId(null); setDisposalAmount(""); setDisposalDate(""); setDisposalReason("");
    },
  });

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Fixed Assets</h1><div className="page-subtitle">Track equipment, vehicles and other depreciable assets.</div></div>
        <div className="page-actions"><Button onClick={() => setCreateOpen(true)}>New asset</Button></div>
      </div>
      <Card>
        {assets.isLoading ? <Spinner /> : assets.data?.items.length === 0 ? <EmptyState text="No fixed assets yet." /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Asset no.</th><th>Name</th><th>Category</th><th>Purchase date</th><th className="num">Cost</th><th className="num">Book value</th><th>Status</th><th /></tr></thead>
            <tbody>{assets.data?.items.map((asset) => <tr key={asset.id}>
              <td style={{ fontWeight: 600 }}>{asset.assetNumber}</td><td>{asset.name}{asset.serialNumber && <div className="muted">SN: {asset.serialNumber}</div>}</td>
              <td>{asset.category?.name ?? "—"}</td><td>{asset.purchaseDate ? fmtDate(asset.purchaseDate) : "—"}</td>
              <td className="num">{fmtMoney(asset.purchaseCost)}</td><td className="num">{fmtMoney(asset.bookValue)}</td><td><StatusBadge status={asset.status} /></td>
              <td className="right">{asset.status !== "DISPOSED" && <Button size="sm" variant="danger" onClick={() => setDisposeId(asset.id)}>Dispose</Button>}</td>
            </tr>)}</tbody>
          </table></div>
        )}
        <Pagination page={page} pageSize={pageSize} total={assets.data?.total ?? 0} onPage={setPage} />
      </Card>

      <Modal title="New fixed asset" open={createOpen} onClose={() => setCreateOpen(false)} className="modal-wide" footer={<><Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button><Button disabled={create.isPending || !name || parseFloat(purchaseCost) < 0 || !purchaseCost} onClick={() => create.mutate()}>{create.isPending ? "Saving…" : "Save asset"}</Button></>}>
        <div className="form-row"><Field label="Asset name *"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field><Field label="Serial number"><Input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} /></Field></div>
        <div className="form-row-3"><Field label="Category"><select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">None</option>{categories.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Purchase cost *"><Input type="number" min={0} step="any" value={purchaseCost} onChange={(e) => setPurchaseCost(e.target.value)} /></Field><Field label="Useful life (years)"><Input type="number" min={1} value={usefulLifeYears} onChange={(e) => setUsefulLifeYears(e.target.value)} /></Field></div>
        <div className="form-row"><Field label="Purchase date"><Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></Field><Field label="Branch"><select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="">My branch</option>{branches.data?.items.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field></div>
        {create.isError && <div className="login-error">{(create.error as Error).message}</div>}
      </Modal>

      <Modal title="Dispose asset" open={Boolean(disposeId)} onClose={() => setDisposeId(null)} footer={<><Button variant="secondary" onClick={() => setDisposeId(null)}>Cancel</Button><Button variant="danger" disabled={dispose.isPending} onClick={() => dispose.mutate()}>{dispose.isPending ? "Posting…" : "Confirm disposal"}</Button></>}>
        <div className="form-row"><Field label="Disposal date"><Input type="date" value={disposalDate} onChange={(e) => setDisposalDate(e.target.value)} /></Field><Field label="Amount received"><Input type="number" min={0} step="any" value={disposalAmount} onChange={(e) => setDisposalAmount(e.target.value)} /></Field></div>
        <Field label="Reason"><Input value={disposalReason} onChange={(e) => setDisposalReason(e.target.value)} /></Field>
        {dispose.isError && <div className="login-error">{(dispose.error as Error).message}</div>}
      </Modal>
    </div>
  );
}
