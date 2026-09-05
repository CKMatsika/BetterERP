import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Page } from "../api/client";
import { Button, Card, Input, Field, Modal, Pagination, Spinner, EmptyState, Badge, usePage } from "../components/ui";
import { fmtDateTime } from "../lib/format";
import { useBranchOptions } from "../lib/org";

interface RoleRow { id: string; name: string; description: string | null; isSystem: boolean; _count: { users: number }; permissions: Array<{ permission: { code: string } }> }
interface UserRow {
  id: string; username: string; fullName: string; email: string | null; isActive: boolean;
  mustChangePassword: boolean; lastLoginAt: string | null; canViewAllBranches: boolean; createdAt: string;
  branch: { code: string; name: string } | null;
  roles: Array<{ role: { id: string; name: string } }>;
}

export default function Users() {
  const qc = useQueryClient();
  const { page, pageSize, setPage } = usePage();
  const [tab, setTab] = useState<"users" | "roles">("users");
  const [createOpen, setCreateOpen] = useState(false);
  const branchOpts = useBranchOptions();

  const [username, setUsername] = useState(""); const [fullName, setFullName] = useState(""); const [email, setEmail] = useState("");
  const [password, setPassword] = useState(""); const [branchId, setBranchId] = useState(""); const [roleIds, setRoleIds] = useState<string[]>([]);
  const [canViewAllBranches, setCanViewAllBranches] = useState(false);

  const users = useQuery({ queryKey: ["users", page], queryFn: () => api.get<Page<UserRow>>("/api/users", { page, pageSize }) });
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api.get<{ items: RoleRow[] }>("/api/users/roles") });

  const toggleRole = (id: string) => setRoleIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const create = useMutation({
    mutationFn: () =>
      api.post("/api/users", {
        username, fullName, email: email || undefined, password: password || undefined,
        branchId: branchId || undefined, roleIds, canViewAllBranches,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setCreateOpen(false);
      setUsername(""); setFullName(""); setEmail(""); setPassword(""); setBranchId(""); setRoleIds([]); setCanViewAllBranches(false);
    },
  });

  const resetPw = useMutation({
    mutationFn: ({ id }: { id: string }) => api.post(`/api/users/${id}/reset-password`, { newPassword: "Admin123!" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Users &amp; Roles</h1>
          <div className="page-subtitle">Manage logins, roles and permissions.</div>
        </div>
        <div className="page-actions">
          <div className="hstack" style={{ gap: 8 }}>
            <Button variant={tab === "users" ? "primary" : "secondary"} size="sm" onClick={() => setTab("users")}>Users</Button>
            <Button variant={tab === "roles" ? "primary" : "secondary"} size="sm" onClick={() => setTab("roles")}>Roles</Button>
            {tab === "users" && <Button onClick={() => setCreateOpen(true)}>New user</Button>}
          </div>
        </div>
      </div>

      {tab === "users" ? (
        <Card>
          {users.isLoading ? <Spinner /> : users.data!.items.length === 0 ? <EmptyState text="No users." /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Username</th><th>Name</th><th>Email</th><th>Branch</th><th>Roles</th><th>Last login</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {users.data!.items.map((u) => (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 600 }}>{u.username}</td>
                      <td>{u.fullName}</td>
                      <td>{u.email ?? "—"}</td>
                      <td>{u.branch?.code ?? (u.canViewAllBranches ? "All" : "—")}</td>
                      <td>{u.roles.map((r) => r.role.name).join(", ") || "—"}</td>
                      <td>{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "Never"}</td>
                      <td>{u.isActive ? <Badge tone="green">ACTIVE</Badge> : <Badge tone="red">INACTIVE</Badge>}</td>
                      <td className="right">
                        <Button size="sm" variant="secondary" onClick={() => resetPw.mutate({ id: u.id })}>Reset password</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} pageSize={pageSize} total={users.data?.total ?? 0} onPage={setPage} />
        </Card>
      ) : (
        <Card>
          {roles.isLoading ? <Spinner /> : roles.data!.items.length === 0 ? <EmptyState text="No roles." /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Role</th><th>Description</th><th>Users</th><th>Permissions</th></tr></thead>
                <tbody>
                  {roles.data!.items.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.name}{r.isSystem && <Badge tone="blue" style={{ marginLeft: 6 }}>SYSTEM</Badge>}</td>
                      <td>{r.description ?? "—"}</td>
                      <td>{r._count.users}</td>
                      <td><span className="muted">{r.permissions.length} permissions</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Modal
        title="New user"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        className="modal-wide"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button disabled={create.isPending || !username || !fullName} onClick={() => create.mutate()}>
              {create.isPending ? "Creating…" : "Create user"}
            </Button>
          </>
        }
      >
        <div className="form-row">
          <Field label="Username *"><Input value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
          <Field label="Full name *"><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
        </div>
        <div className="form-row">
          <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Temporary password"><Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Default: Admin123!" /></Field>
        </div>
        <div className="form-row">
          <Field label="Branch">
            <select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">No branch</option>
              {branchOpts.data?.items.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <label className="checkbox-row">
            <input type="checkbox" checked={canViewAllBranches} onChange={(e) => setCanViewAllBranches(e.target.checked)} />
            Can view all branches
          </label>
        </div>
        <Field label="Roles">
          <div className="hstack" style={{ flexWrap: "wrap", gap: 8 }}>
            {roles.data?.items.map((r) => (
              <label key={r.id} className="checkbox-row" style={{ gap: 6 }}>
                <input type="checkbox" checked={roleIds.includes(r.id)} onChange={() => toggleRole(r.id)} />
                {r.name}
              </label>
            ))}
          </div>
        </Field>
        {create.isError && <div className="login-error">{(create.error as Error).message}</div>}
      </Modal>
    </div>
  );
}