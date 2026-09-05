import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Page } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Pagination, Spinner, EmptyState, StatusBadge, usePage } from "../components/ui";
import { fmtMoney, fmtDateTime } from "../lib/format";

interface ApprovalRow {
  id: string;
  entityType: string;
  entityRef: string;
  status: string;
  amount: number | null;
  reason: string | null;
  createdAt: string;
  requestedBy: { fullName: string } | null;
  actions: Array<{ action: string; role: { name: string } | null; comment: string | null; actionAt: string }>;
}

export default function Approvals() {
  const qc = useQueryClient();
  const { page, pageSize, setPage } = usePage();
  const { user } = useAuth();

  const q = useQuery({
    queryKey: ["approvals", page],
    queryFn: () => api.get<Page<ApprovalRow>>("/api/approvals", { page, pageSize }),
  });
  const pending = useQuery({
    queryKey: ["approvals", "my-pending"],
    queryFn: () => api.get<{ items: ApprovalRow[] }>("/api/approvals/my-pending"),
  });

  const act = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "reject" }) => api.post(`/api/approvals/${id}/${decision}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const canAct = user?.permissions.includes("approval.manage");

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Approvals</h1>
          <div className="page-subtitle">Purchase orders, transfers and other workflow approvals.</div>
        </div>
      </div>

      {canAct && (
        <Card style={{ marginBottom: 16 }}>
          <h3 className="card-title" style={{ marginBottom: 8 }}>Awaiting my approval ({pending.data?.items.length ?? 0})</h3>
          {pending.isLoading ? <Spinner /> : pending.data!.items.length === 0 ? <EmptyState text="Nothing awaiting your approval." /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Type</th><th>Reference</th><th>Requested by</th><th className="num">Amount</th><th>Reason</th><th>Created</th><th /></tr></thead>
                <tbody>
                  {pending.data!.items.map((a) => (
                    <tr key={a.id}>
                      <td>{a.entityType}</td>
                      <td style={{ fontWeight: 600 }}>{a.entityRef}</td>
                      <td>{a.requestedBy?.fullName ?? "—"}</td>
                      <td className="num">{a.amount != null ? fmtMoney(a.amount) : "—"}</td>
                      <td>{a.reason ?? "—"}</td>
                      <td>{fmtDateTime(a.createdAt)}</td>
                      <td className="right">
                        <Button size="sm" onClick={() => act.mutate({ id: a.id, decision: "approve" })} disabled={act.isPending}>Approve</Button>
                        <Button size="sm" variant="danger" onClick={() => act.mutate({ id: a.id, decision: "reject" })} disabled={act.isPending} style={{ marginLeft: 6 }}>Reject</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card>
        {q.isLoading ? <Spinner /> : q.data!.items.length === 0 ? <EmptyState text="No approval requests." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Type</th><th>Reference</th><th>Requested by</th><th className="num">Amount</th><th>Created</th><th>Status</th></tr></thead>
              <tbody>
                {q.data!.items.map((a) => (
                  <tr key={a.id}>
                    <td>{a.entityType}</td>
                    <td style={{ fontWeight: 600 }}>{a.entityRef}</td>
                    <td>{a.requestedBy?.fullName ?? "—"}</td>
                    <td className="num">{a.amount != null ? fmtMoney(a.amount) : "—"}</td>
                    <td>{fmtDateTime(a.createdAt)}</td>
                    <td><StatusBadge status={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={pageSize} total={q.data?.total ?? 0} onPage={setPage} />
      </Card>
    </div>
  );
}