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
  wholesalePrice: number | null;
  reorderLevel: number | null;
  reorderQuantity: number | null;
  onHand?: number;
  status: string;
  isPosFeatured?: boolean;
  posColor?: string | null;
  department?: { id: string, name: string } | null;
  markup?: number | null;
  gp?: number | null;
}

export default function Products() {
  const qc = useQueryClient();
  const { page, pageSize, setPage } = usePage();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const f = useForm();

  const q = useQuery({
    queryKey: ["products", page, search.trim()],
    queryFn: () => api.get<Page<ProductRow>>("/api/products", { page, pageSize, search: search.trim() || undefined }),
  });

  const depts = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get<{ items: { id: string; name: string }[] }>("/api/company/departments"),
  });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ id: string }>("/api/products", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      setCreateOpen(false);
      f.reset();
    },
  });

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put<{ id: string }>(`/api/products/${editingId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      setEditOpen(false);
      f.reset();
      setEditingId(null);
    },
  });

  const openEdit = (p: ProductRow) => {
    f.set("sku", p.sku);
    f.set("name", p.name);
    f.set("type", p.type);
    f.set("barcode", p.barcode || "");
    f.set("costPrice", p.costPrice?.toString() || "");
    f.set("sellingPrice", p.sellingPrice?.toString() || "");
    f.set("wholesalePrice", p.wholesalePrice?.toString() || "");
    f.set("reorderLevel", p.reorderLevel?.toString() || "");
    f.set("reorderQuantity", p.reorderQuantity?.toString() || "");
    f.set("departmentId", p.department?.id || "");
    f.set("markup", p.markup?.toString() || "");
    f.set("gp", p.gp?.toString() || "");
    f.set("isPosFeatured", p.isPosFeatured ? "true" : "false");
    f.set("posColor", p.posColor || "#ffffff");
    setEditingId(p.id);
    setEditOpen(true);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Products</h1>
          <div className="page-subtitle">Stock items, services and their pricing.</div>
        </div>
        <div className="page-actions"><Button onClick={() => { f.reset(); setCreateOpen(true); }}>New product</Button></div>
      </div>

      <Card>
        <div className="hstack mb-2" style={{ padding: "2px 0 12px" }}>
          <Input placeholder="Search SKU, barcode or name…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={{ maxWidth: 340 }} />
        </div>
        {q.isLoading ? <Spinner /> : q.data!.items.length === 0 ? <EmptyState text="No products found." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>SKU</th><th>Name</th><th>Dept.</th><th>Type</th><th className="num">Cost</th><th className="num">Selling</th><th className="num">On hand</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {q.data!.items.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.sku}</td>
                    <td>{p.name}</td>
                    <td>{p.department?.name ?? "—"}</td>
                    <td>{p.type}</td>
                    <td className="num">{fmtMoney(p.costPrice ?? 0)}</td>
                    <td className="num">{fmtMoney(p.sellingPrice ?? 0)}</td>
                    <td className="num">{fmtQty(p.onHand ?? 0)}</td>
                    <td><StatusBadge status={p.status} /></td>
                    <td><Button size="sm" variant="secondary" onClick={() => openEdit(p)}>Edit</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={pageSize} total={q.data?.total ?? 0} onPage={setPage} />
      </Card>

      <Modal
        title={editOpen ? "Edit product" : "New product"}
        open={createOpen || editOpen}
        onClose={() => { setCreateOpen(false); setEditOpen(false); f.reset(); }}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setCreateOpen(false); setEditOpen(false); f.reset(); }}>Cancel</Button>
            <Button disabled={(editOpen ? update.isPending : create.isPending) || !f.v.sku || !f.v.name} onClick={() => editOpen ? update.mutate(f.toBody()) : create.mutate(f.toBody())}>
              {editOpen ? (update.isPending ? "Saving…" : "Save changes") : (create.isPending ? "Saving…" : "Create product")}
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
          <Field label="Department">
            <select className="input" value={f.v.departmentId || ""} onChange={(e) => f.set("departmentId", e.target.value)}>
              <option value="">None</option>
              {depts.data?.items.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="form-row-3">
          <Field label="Cost price"><Input type="number" min={0} value={f.v.costPrice} onChange={(e) => f.set("costPrice", e.target.value)} /></Field>
          <Field label="Markup (%)"><Input type="number" min={0} value={f.v.markup} onChange={(e) => f.set("markup", e.target.value)} /></Field>
          <Field label="GP (%)"><Input type="number" min={0} value={f.v.gp} onChange={(e) => f.set("gp", e.target.value)} /></Field>
        </div>
        <div className="form-row-3">
          <Field label="Selling price"><Input type="number" min={0} value={f.v.sellingPrice} onChange={(e) => f.set("sellingPrice", e.target.value)} /></Field>
          <Field label="Wholesale price"><Input type="number" min={0} value={f.v.wholesalePrice} onChange={(e) => f.set("wholesalePrice", e.target.value)} /></Field>
        </div>
        <div className="form-row">
          <Field label="Reorder level"><Input type="number" min={0} value={f.v.reorderLevel} onChange={(e) => f.set("reorderLevel", e.target.value)} /></Field>
          <Field label="Reorder quantity"><Input type="number" min={0} value={f.v.reorderQuantity} onChange={(e) => f.set("reorderQuantity", e.target.value)} /></Field>
        </div>
        <div className="form-row">
          <Field label="Feature on POS?">
            <label className="hstack" style={{ marginTop: 8, gap: 8 }}>
              <input type="checkbox" checked={f.v.isPosFeatured === "true"} onChange={(e) => f.set("isPosFeatured", e.target.checked ? "true" : "false")} />
              <span>Yes, show as card on POS</span>
            </label>
          </Field>
          <Field label="POS Card Color">
            <Input type="color" value={f.v.posColor || "#ffffff"} onChange={(e) => f.set("posColor", e.target.value)} disabled={f.v.isPosFeatured !== "true"} />
          </Field>
        </div>
        {(create.isError || update.isError) && <div className="login-error">{((create.error || update.error) as Error).message}</div>}
      </Modal>
    </div>
  );
}

function useForm() {
  const [v, setV] = useState<Record<string, string>>({ sku: "", name: "", type: "STOCK", isPosFeatured: "false", posColor: "#ffffff", departmentId: "", markup: "", gp: "" });
  const set = (k: string, val: string) => setV((p) => {
    const next = { ...p, [k]: val };
    
    if (k === "costPrice" || k === "sellingPrice" || k === "markup" || k === "gp") {
      const cStr = k === "costPrice" ? val : p.costPrice;
      const sStr = k === "sellingPrice" ? val : p.sellingPrice;
      const mStr = k === "markup" ? val : p.markup;
      const gStr = k === "gp" ? val : p.gp;
      
      const c = parseFloat(cStr);
      const s = parseFloat(sStr);
      const m = parseFloat(mStr);
      const g = parseFloat(gStr);

      if (k === "costPrice") {
        if (!isNaN(c) && !isNaN(m) && p.markup !== "") {
          const newS = c * (1 + m / 100);
          next.sellingPrice = newS.toFixed(2);
          next.gp = newS !== 0 ? (((newS - c) / newS) * 100).toFixed(2) : "0";
        } else if (!isNaN(c) && !isNaN(s) && p.sellingPrice !== "") {
          next.markup = c !== 0 ? (((s - c) / c) * 100).toFixed(2) : "0";
          next.gp = s !== 0 ? (((s - c) / s) * 100).toFixed(2) : "0";
        }
      } else if (k === "sellingPrice") {
        if (!isNaN(s) && !isNaN(c) && p.costPrice !== "") {
          next.markup = c !== 0 ? (((s - c) / c) * 100).toFixed(2) : "0";
          next.gp = s !== 0 ? (((s - c) / s) * 100).toFixed(2) : "0";
        }
      } else if (k === "markup") {
        if (!isNaN(m) && !isNaN(c) && p.costPrice !== "") {
          const newS = c * (1 + m / 100);
          next.sellingPrice = newS.toFixed(2);
          next.gp = newS !== 0 ? (((newS - c) / newS) * 100).toFixed(2) : "0";
        }
      } else if (k === "gp") {
        if (!isNaN(g) && !isNaN(c) && p.costPrice !== "" && g !== 100) {
          const newS = c / (1 - g / 100);
          next.sellingPrice = newS.toFixed(2);
          next.markup = c !== 0 ? (((newS - c) / c) * 100).toFixed(2) : "0";
        } else if (!isNaN(g) && !isNaN(s) && p.sellingPrice !== "") {
          const newC = s * (1 - g / 100);
          next.costPrice = newC.toFixed(2);
          next.markup = newC !== 0 ? (((s - newC) / newC) * 100).toFixed(2) : "0";
        }
      }
    }
    
    return next;
  });
  const reset = () => setV({ sku: "", name: "", type: "STOCK", barcode: "", costPrice: "", sellingPrice: "", wholesalePrice: "", reorderLevel: "", reorderQuantity: "", isPosFeatured: "false", posColor: "#ffffff", departmentId: "", markup: "", gp: "" });
  const toBody = (): Record<string, unknown> => {
    const body: Record<string, unknown> = { sku: v.sku, name: v.name, type: v.type };
    for (const k of ["barcode", "costPrice", "sellingPrice", "wholesalePrice", "reorderLevel", "reorderQuantity", "posColor", "departmentId", "markup", "gp"] as const) {
      if (v[k] !== undefined && v[k] !== "") body[k] = k.includes("price") || k.includes("Level") || k.includes("Quantity") || k === "markup" || k === "gp" ? parseFloat(v[k]) : v[k];
    }
    body.isPosFeatured = v.isPosFeatured === "true";
    if (v.barcode === "") delete body.barcode;
    return body;
  };
  return { v, set, reset, toBody };
}