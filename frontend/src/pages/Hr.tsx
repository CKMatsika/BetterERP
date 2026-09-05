import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Page } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Input, Field, Modal, Pagination, Spinner, EmptyState, StatusBadge, Badge, usePage } from "../components/ui";
import { fmtMoney } from "../lib/format";
import { useBranchOptions } from "../lib/org";

interface EmpRow {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  employmentStatus: string;
  employmentType: string | null;
  salaryType: string;
  basicSalary: number;
  hireDate: string | null;
  department: { name: string } | null;
  position: { name: string } | null;
  branch: { code: string } | null;
  user: { username: string; isActive: boolean } | null;
}

export default function Hr() {
  const qc = useQueryClient();
  const { page, pageSize, setPage } = usePage();
  const { user } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const branchOpts = useBranchOptions();

  const [firstName, setFirstName] = useState(""); const [lastName, setLastName] = useState("");
  const [departmentId, setDepartmentId] = useState(""); const [positionId, setPositionId] = useState("");
  const [employmentType, setEmploymentType] = useState("FULL_TIME");
  const [hireDate, setHireDate] = useState("");
  const [salaryType, setSalaryType] = useState("MONTHLY");
  const [basicSalary, setBasicSalary] = useState("");
  const [branchId, setBranchId] = useState("");
  const [phone, setPhone] = useState("");
  const [nationalId, setNationalId] = useState("");

  const q = useQuery({
    queryKey: ["employees", page],
    queryFn: () => api.get<Page<EmpRow>>("/api/hr/employees", { page, pageSize }),
  });
  const depts = useQuery({ queryKey: ["departments"], queryFn: () => api.get<{ items: Array<{ id: string; name: string }> }>("/api/company/departments") });
  const positions = useQuery({ queryKey: ["positions"], queryFn: () => api.get<{ items: Array<{ id: string; name: string }> }>("/api/hr/positions") });

  const create = useMutation({
    mutationFn: () =>
      api.post("/api/hr/employees", {
        firstName, lastName,
        departmentId: departmentId || undefined, positionId: positionId || undefined,
        employmentType, hireDate: hireDate || undefined, salaryType,
        basicSalary: parseFloat(basicSalary) || undefined,
        branchId: branchId || undefined,
        phone: phone || undefined, nationalId: nationalId || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      setCreateOpen(false);
      setFirstName(""); setLastName(""); setDepartmentId(""); setPositionId(""); setEmploymentType("FULL_TIME"); setHireDate(""); setSalaryType("MONTHLY"); setBasicSalary(""); setBranchId(""); setPhone(""); setNationalId("");
    },
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">HR / Employees</h1>
          <div className="page-subtitle">Employee records for payroll and user accounts.</div>
        </div>
        <div className="page-actions"><Button onClick={() => setCreateOpen(true)}>New employee</Button></div>
      </div>

      <Card>
        {q.isLoading ? <Spinner /> : q.data!.items.length === 0 ? <EmptyState text="No employees yet." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Number</th><th>Name</th><th>Department</th><th>Position</th><th className="num">Basic salary</th><th>Branch</th><th>User</th><th>Status</th></tr></thead>
              <tbody>
                {q.data!.items.map((e) => (
                  <tr key={e.id}>
                    <td style={{ fontWeight: 600 }}>{e.employeeNumber}</td>
                    <td>{e.firstName} {e.lastName}</td>
                    <td>{e.department?.name ?? "—"}</td>
                    <td>{e.position?.name ?? "—"}</td>
                    <td className="num">{fmtMoney(e.basicSalary ?? 0)}</td>
                    <td>{e.branch?.code ?? "—"}</td>
                    <td>{e.user ? <Badge tone={e.user.isActive ? "green" : "amber"}>{e.user.username}</Badge> : "—"}</td>
                    <td><StatusBadge status={e.employmentStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={pageSize} total={q.data?.total ?? 0} onPage={setPage} />
      </Card>

      <Modal
        title="New employee"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        className="modal-wide"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button disabled={create.isPending || !firstName || !lastName} onClick={() => create.mutate()}>
              {create.isPending ? "Creating…" : "Create employee"}
            </Button>
          </>
        }
      >
        <div className="form-row">
          <Field label="First name *"><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></Field>
          <Field label="Last name *"><Input value={lastName} onChange={(e) => setLastName(e.target.value)} /></Field>
        </div>
        <div className="form-row">
          <Field label="Department">
            <select className="input" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">None</option>
              {depts.data?.items.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Position">
            <select className="input" value={positionId} onChange={(e) => setPositionId(e.target.value)}>
              <option value="">None</option>
              {positions.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="form-row-3">
          <Field label="Employment type">
            <select className="input" value={employmentType} onChange={(e) => setEmploymentType(e.target.value)}>
              <option value="FULL_TIME">Full time</option><option value="PART_TIME">Part time</option><option value="CONTRACT">Contract</option><option value="CASUAL">Casual</option>
            </select>
          </Field>
          <Field label="Salary type">
            <select className="input" value={salaryType} onChange={(e) => setSalaryType(e.target.value)}>
              <option value="MONTHLY">Monthly</option><option value="HOURLY">Hourly</option>
            </select>
          </Field>
          <Field label={salaryType === "HOURLY" ? "Hourly rate" : "Basic salary"}><Input type="number" min={0} step="any" value={basicSalary} onChange={(e) => setBasicSalary(e.target.value)} /></Field>
        </div>
        <div className="form-row-3">
          <Field label="Hire date"><Input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} /></Field>
          <Field label="Branch">
            <select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">My branch</option>
              {branchOpts.data?.items.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        </div>
        <Field label="National ID"><Input value={nationalId} onChange={(e) => setNationalId(e.target.value)} /></Field>
        <div className="muted" style={{ fontSize: 12.5 }}>Agent: {user?.fullName}</div>
        {create.isError && <div className="login-error">{(create.error as Error).message}</div>}
      </Modal>
    </div>
  );
}