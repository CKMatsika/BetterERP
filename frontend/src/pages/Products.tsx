import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Page } from "../api/client";
import { Button, Card, Input, Field, Modal, Pagination, Spinner, EmptyState, StatusBadge, usePage } from "../components/ui";
import { fmtMoney, fmtQty } from "../lib/format";

interface ProductRow {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  type: string;
  category?: { name: string } | null;
  costPrice: number | null;
  sellingPrice: number | null;
  reorderLevel: number | null;
  onHand?: number;
  status: string;
}

export default function Products() {
  const qc = useQueryClient();
  const { page, pageSize, setPage } = usePage();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const f = useForm();

  const q = useQuery({
    queryKey: ["products", page, search.trim()],
    queryFn: () => api.get<Page<ProductRow>>("/api/products", { page, pageSize, search: search.trim() || undefined }),
  });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ id: string }>("/api/products", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      setCreateOpen(false);
      f.reset();
    },
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Products</h1>
          <div className="page-subtitle">Stock items, services and their pricing.</div>
        </div>
        <div className="page-actions"><Button onClick={() => setCreateOpen(true)}>New product</Button></div>
      </div>

      <Card>
        <div className="hstack mb-2" style={{ padding: "2px 0 12px" }}>
          <Input placeholder="Search SKU, barcode or name…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={{ maxWidth: 340 }} />
        </div>
        {q.isLoading ? <Spinner /> : q.data!.items.length === 0 ? <EmptyState text="No products found." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>SKU</th><th>Name</th><th>Barcode</th><th>Type</th><th className="num">Cost</th><th className="num">Selling</th><th className="num">On hand</th><th>Status</th></tr></thead>
              <tbody>
                {q.data!.items.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.sku}</td>
                    <td>{p.name}</td>
                    <td>{p.barcode ?? "—"}</td>
                    <td>{p.type}</td>
                    <td className="num">{fmtMoney(p.costPrice ?? 0)}</td>
                    <td className="num">{fmtMoney(p.sellingPrice ?? 0)}</td>
                    <td className="num">{fmtQty(p.onHand ?? 0)}</td>
                    <td><StatusBadge status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={pageSize} total={q.data?.total ?? 0} onPage={setPage} />
      </Card>

      <Modal
        title="New product"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button disabled={create.isPending || !f.v.sku || !f.v.name} onClick={() => create.mutate(f.toBody())}>
              {create.isPending ? "Saving…" : "Create product"}
            </Button>
          </>
        }
      >
        <div className="form-row">
          <Field label="SKU *"><Input value={f.v.sku} onChange={(e) => f.set("sku", e.target.value)} /></Field>
          <Field label="Name *"><Input value={f.v.name} onChange={(e) => f.set("name", e.target.value)} /></Field>
        </div>
        <div className="form-row">
          <Field label="Barcode"><Input value={f.v.barcode} onChange={(e) => f.set("barcode", e.target.value)} /></Field>
          <Field label="Type">
            <select className="input" value={f.v.type} onChange={(e) => f.set("type", e.target.value)}>
              <option value="STOCK">Stock</option>
              <option value="SERVICE">Service</option>
              <option value="NON_STOCK">Non-stock</option>
              <option value="ASSET">Asset</option>
            </select>
          </Field>
        </div>
        <div className="form-row-3">
          <Field label="Cost price"><Input type="number" min={0} value={f.v.costPrice} onChange={(e) => f.set("costPrice", e.target.value)} /></Field>
          <Field label="Selling price"><Input type="number" min={0} value={f.v.sellingPrice} onChange={(e) => f.set("sellingPrice", e.target.value)} /></Field>
          <Field label="Wholesale price"><Input type="number" min={0} value={f.v.wholesalePrice} onChange={(e) => f.set("wholesalePrice", e.target.value)} /></Field>
        </div>
        <div className="form-row">
          <Field label="Reorder level"><Input type="number" min={0} value={f.v.reorderLevel} onChange={(e) => f.set("reorderLevel", e.target.value)} /></Field>
          <Field label="Reorder quantity"><Input type="number" min={0} value={f.v.reorderQuantity} onChange={(e) => f.set("reorderQuantity", e.target.value)} /></Field>
        </div>
        {create.isError && <div className="login-error">{(create.error as Error).message}</div>}
      </Modal>
    </div>
  );
}

function useForm() {
  const [v, setV] = useState<Record<string, string>>({ sku: "", name: "", type: "STOCK" });
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));
  const reset = () => setV({ sku: "", name: "", type: "STOCK" });
  const toBody = (): Record<string, unknown> => {
    const body: Record<string, unknown> = { sku: v.sku, name: v.name, type: v.type };
    for (const k of ["barcode", "costPrice", "sellingPrice", "wholesalePrice", "reorderLevel", "reorderQuantity"] as const) {
      if (v[k] !== undefined && v[k] !== "") body[k] = k.includes("price") || k.includes("Level") || k.includes("Quantity") ? parseFloat(v[k]) : v[k];
    }
    if (v.barcode === "") delete body.barcode;
    return body;
  };
  return { v, set, reset, toBody };
}