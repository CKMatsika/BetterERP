import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Page } from "../api/client";
import { Button, Card, Input, Field, Modal, Pagination, Spinner, EmptyState, StatusBadge, usePage } from "../components/ui";
import { fmtQty, fmtDateTime } from "../lib/format";
import { useBranchOptions, useProductOptions } from "../lib/org";

interface TransferRow {
  id: string;
  reference: string;
  status: string;
  sourceBranch: { id: string; code: string; name: string };
  destinationBranch: { id: string; code: string; name: string };
  createdAt: string;
  lines: Array<{ product: { sku: string; name: string } | null; requestedQty: number }>;
}

export default function Transfers() {
  const qc = useQueryClient();
  const { page, pageSize, setPage } = usePage();
  const [createOpen, setCreateOpen] = useState(false);
  const branchOpts = useBranchOptions();
  const products = useProductOptions();

  const [sourceBranchId, setSourceBranchId] = useState("");
  const [destinationBranchId, setDestinationBranchId] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Array<{ productId: string; qty: string }>>([{ productId: "", qty: "" }]);

  const q = useQuery({
    queryKey: ["transfers", page],
    queryFn: () => api.get<Page<TransferRow>>("/api/transfers", { page, pageSize }),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post("/api/transfers", {
        sourceBranchId,
        destinationBranchId,
        note: note || undefined,
        lines: lines.filter((l) => l.productId && parseFloat(l.qty) > 0).map((l) => ({ productId: l.productId, requestedQty: parseFloat(l.qty) })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transfers"] });
      setCreateOpen(false);
      setSourceBranchId(""); setDestinationBranchId(""); setNote(""); setLines([{ productId: "", qty: "" }]);
    },
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "dispatch" | "receive" | "cancel" }) => api.post(`/api/transfers/${id}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["transfers"] }),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Branch Transfers</h1>
          <div className="page-subtitle">Move stock between branches.</div>
        </div>
        <div className="page-actions"><Button onClick={() => setCreateOpen(true)}>New transfer</Button></div>
      </div>

      <Card>
        {q.isLoading ? <Spinner /> : q.data!.items.length === 0 ? <EmptyState text="No transfers yet." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Reference</th><th>From</th><th>To</th><th>Created</th><th>Items</th><th>Status</th><th /></tr></thead>
              <tbody>
                {q.data!.items.map((t) => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 600 }}>{t.reference}</td>
                    <td>{t.sourceBranch.name}</td>
                    <td>{t.destinationBranch.name}</td>
                    <td>{fmtDateTime(t.createdAt)}</td>
                    <td>
                      {t.lines.map((l) => `${l.product?.name ?? "?"} (${fmtQty(l.requestedQty)})`).join(", ")}
                    </td>
                    <td><StatusBadge status={t.status} /></td>
                    <td className="right">
                      {t.status === "PENDING_APPROVAL" && <Button size="sm" variant="secondary" onClick={() => act.mutate({ id: t.id, action: "approve" })}>Approve</Button>}
                      {t.status === "APPROVED" && <Button size="sm" onClick={() => act.mutate({ id: t.id, action: "dispatch" })}>Dispatch</Button>}
                      {t.status === "DISPATCHED" && <Button size="sm" onClick={() => act.mutate({ id: t.id, action: "receive" })}>Receive</Button>}
                      {["PENDING_APPROVAL", "APPROVED"].includes(t.status) && (
                        <Button size="sm" variant="danger" onClick={() => act.mutate({ id: t.id, action: "cancel" })}>Cancel</Button>
                      )}
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
        title="New branch transfer"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        className="modal-wide"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              disabled={create.isPending || !sourceBranchId || !destinationBranchId || sourceBranchId === destinationBranchId || lines.filter((l) => l.productId && parseFloat(l.qty) > 0).length === 0}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "Creating…" : "Create transfer"}
            </Button>
          </>
        }
      >
        <div className="form-row">
          <Field label="Source branch *">
            <select className="input" value={sourceBranchId} onChange={(e) => setSourceBranchId(e.target.value)}>
              <option value="">Select…</option>
              {branchOpts.data?.items.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
            </select>
          </Field>
          <Field label="Destination branch *">
            <select className="input" value={destinationBranchId} onChange={(e) => setDestinationBranchId(e.target.value)}>
              <option value="">Select…</option>
              {branchOpts.data?.items.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
            </select>
          </Field>
        </div>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></Field>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Product</th><th style={{ width: 140 }}>Requested qty</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <select className="input" value={l.productId} onChange={(e) => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, productId: e.target.value } : x)))}>
                      <option value="">Select product…</option>
                      {products.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                    </select>
                  </td>
                  <td><Input type="number" min={1} step="any" value={l.qty} onChange={(e) => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></td>
                  <td className="right"><Button size="sm" variant="ghost" onClick={() => setLines((prev) => prev.length > 1 ? prev.filter((_, j) => j !== i) : prev)}>Remove</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setLines((prev) => [...prev, { productId: "", qty: "" }])}>Add line</Button>
        {create.isError && <div className="login-error">{(create.error as Error).message}</div>}
      </Modal>
    </div>
  );
}