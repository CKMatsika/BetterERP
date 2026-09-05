import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api/client";
import { Button, Card, EmptyState } from "../components/ui";

const HEADERS = ["sku", "barcode", "name", "description", "category", "brand", "unitOfMeasure", "costPrice", "sellingPrice", "wholesalePrice", "retailPrice", "taxType", "reorderLevel", "reorderQuantity", "minimumStock", "maximumStock"];
const SUPPLIER_HEADERS = ["code", "name", "taxNumber", "contactPerson", "phone", "email", "address", "city", "paymentTerms", "currency"];
const CUSTOMER_HEADERS = ["code", "name", "customerType", "taxNumber", "phone", "email", "address", "city", "paymentTerms", "currency", "creditLimit"];
const EMPLOYEE_HEADERS = ["employeeNumber", "firstName", "lastName", "middleName", "nationalId", "phone", "email", "employmentType", "salaryType", "basicSalary", "hireDate", "branchId"];

type ImportRow = Record<string, string>;
interface ImportResult { success: boolean; summary: { total: number; created: number; updated: number; skipped: number; errors: number }; errors: Array<{ row: number; error: string }> }

function parseCsv(text: string, required: string[]): ImportRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV must contain a header and at least one data row");
  const parseLine = (line: string) => {
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
  };
  const headers = parseLine(lines[0]);
  if (!required.every((header) => headers.includes(header))) throw new Error(`CSV must include ${required.join(" and ")} columns`);
  return lines.slice(1).map((line) => Object.fromEntries(parseLine(line).map((value, index) => [headers[index] ?? "", value])));
}

function downloadTemplate(headers: string[], name: string) {
  const blob = new Blob([`${headers.join(",")}\n`], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export default function Imports() {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [kind, setKind] = useState<"products" | "suppliers" | "customers" | "employees">("products");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const importData = useMutation({
    mutationFn: () => api.post<ImportResult>(`/api/${kind === "products" ? "products" : kind === "suppliers" ? "procurement/suppliers" : kind === "customers" ? "customers" : "hr/employees"}/import`, { rows }),
    onSuccess: (data) => setResult(data),
  });

  const selectFile = (file: File | undefined) => {
    if (!file) return;
    setError(null); setResult(null);
    const headers = kind === "products" ? ["sku", "name"] : kind === "employees" ? ["firstName", "lastName"] : ["name"];
    void file.text().then((text) => { setRows(parseCsv(text, headers)); setFileName(file.name); }).catch((reason: unknown) => { setRows([]); setFileName(""); setError(reason instanceof Error ? reason.message : "Could not read CSV"); });
  };

  return <div>
    <div className="page-header"><div><h1 className="page-title">Data Imports</h1><div className="page-subtitle">Validate and import master data without creating partial financial transactions.</div></div></div>
    <div className="hstack mb-2">{(["products", "suppliers", "customers", "employees"] as const).map((item) => <Button key={item} size="sm" variant={kind === item ? "primary" : "secondary"} onClick={() => { setKind(item); setRows([]); setResult(null); setFileName(""); }}>{item[0].toUpperCase() + item.slice(1)}</Button>)}</div>
    <Card title={`${kind[0].toUpperCase() + kind.slice(1)} import`} actions={<Button variant="secondary" onClick={() => downloadTemplate(kind === "products" ? HEADERS : kind === "suppliers" ? SUPPLIER_HEADERS : kind === "customers" ? CUSTOMER_HEADERS : EMPLOYEE_HEADERS, `${kind}-import-template.csv`)}>Download template</Button>}>
      <div className="stack"><label className="btn btn-secondary" style={{ width: "fit-content" }}><span>Choose {kind} CSV</span><input type="file" accept=".csv,text/csv" hidden onChange={(event) => { selectFile(event.target.files?.[0]); event.target.value = ""; }} /></label>{fileName && <div className="muted">Selected: {fileName} · {rows.length} row(s)</div>}{error && <div className="login-error">{error}</div>}{rows.length === 0 ? <EmptyState text="Choose a CSV file or download the template to begin." /> : <><div className="table-wrap"><table className="table"><thead><tr>{(kind === "products" ? HEADERS : kind === "suppliers" ? SUPPLIER_HEADERS : kind === "customers" ? CUSTOMER_HEADERS : EMPLOYEE_HEADERS).slice(0, 6).map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.slice(0, 10).map((row, index) => <tr key={index}>{(kind === "products" ? HEADERS : kind === "suppliers" ? SUPPLIER_HEADERS : kind === "customers" ? CUSTOMER_HEADERS : EMPLOYEE_HEADERS).slice(0, 6).map((header) => <td key={header}>{row[header] || "—"}</td>)}</tr>)}</tbody></table></div><div className="hstack"><Button disabled={importData.isPending} onClick={() => importData.mutate()}>{importData.isPending ? "Importing…" : `Import ${rows.length} row(s)`}</Button><span className="muted">Showing the first 10 rows.</span></div></>}{importData.isError && <div className="login-error">{(importData.error as Error).message}</div>}</div>
    </Card>
    {result && <Card title="Import result" style={{ marginTop: 16 }}><div className="grid grid-4"><div><div className="muted">Created</div><strong>{result.summary.created}</strong></div><div><div className="muted">Updated</div><strong>{result.summary.updated}</strong></div><div><div className="muted">Skipped</div><strong>{result.summary.skipped}</strong></div><div><div className="muted">Errors</div><strong>{result.summary.errors}</strong></div></div>{result.errors.length > 0 && <div className="table-wrap" style={{ marginTop: 12 }}><table className="table"><thead><tr><th>Row</th><th>Error</th></tr></thead><tbody>{result.errors.map((item) => <tr key={`${item.row}-${item.error}`}><td>{item.row}</td><td>{item.error}</td></tr>)}</tbody></table></div>}</Card>}
  </div>;
}
