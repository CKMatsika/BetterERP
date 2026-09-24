import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Button, Input, Modal, Select } from "../components/ui";
import { Plus, Play } from "lucide-react";
import { fmtMoney, fmtQty } from "../components/ui";

export default function ProductionRuns() {
  const [activeTab, setActiveTab] = useState<"runs" | "recipes">("runs");
  
  const { data: runs } = useQuery({
    queryKey: ["production", "runs"],
    queryFn: () => api.get<any[]>("/api/production/runs"),
  });

  const { data: recipes } = useQuery({
    queryKey: ["production", "recipes"],
    queryFn: () => api.get<any[]>("/api/production/recipes"),
  });

  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);
  const [isRunModalOpen, setIsRunModalOpen] = useState(false);

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Production & Manufacturing</h1>
        <div style={{ display: "flex", gap: "10px" }}>
          {activeTab === "recipes" ? (
            <Button onClick={() => setIsRecipeModalOpen(true)}>
              <Plus size={16} /> New Recipe
            </Button>
          ) : (
            <Button onClick={() => setIsRunModalOpen(true)}>
              <Play size={16} /> Start Production Run
            </Button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: "15px", marginBottom: "20px" }}>
        <Button variant={activeTab === "runs" ? "primary" : "secondary"} onClick={() => setActiveTab("runs")}>Production Runs</Button>
        <Button variant={activeTab === "recipes" ? "primary" : "secondary"} onClick={() => setActiveTab("recipes")}>Recipes (BOM)</Button>
      </div>

      <div className="page-content">
        {activeTab === "runs" && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Reference</th>
                  <th>Recipe</th>
                  <th>Product</th>
                  <th>Output Qty</th>
                  <th>Total Cost</th>
                  <th>Status</th>
                  <th>User</th>
                </tr>
              </thead>
              <tbody>
                {Array.isArray(runs) && runs.map(row => (
                  <tr key={row.id}>
                    <td>{new Date(row.createdAt).toLocaleDateString()}</td>
                    <td>{row.reference}</td>
                    <td>{row.recipe?.name}</td>
                    <td>{row.recipe?.product?.name}</td>
                    <td>{fmtQty(row.outputQty)}</td>
                    <td>{fmtMoney(row.totalCost)}</td>
                    <td><span className={`badge ${row.status === 'COMPLETED' ? 'success' : ''}`}>{row.status}</span></td>
                    <td>{row.createdBy?.fullName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        
        {activeTab === "recipes" && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Recipe Name</th>
                  <th>Produces</th>
                  <th>Base Yield</th>
                  <th>Ingredients Count</th>
                  <th>Created At</th>
                </tr>
              </thead>
              <tbody>
                {Array.isArray(recipes) && recipes.map(row => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.product?.name}</td>
                    <td>{fmtQty(row.yield)}</td>
                    <td>{row.ingredients?.length}</td>
                    <td>{new Date(row.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isRecipeModalOpen && <RecipeModal onClose={() => setIsRecipeModalOpen(false)} />}
      {isRunModalOpen && <RunModal onClose={() => setIsRunModalOpen(false)} recipes={recipes || []} />}
    </div>
  );
}

function RecipeModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ productId: "", name: "", yield: 1 });
  const [ingredients, setIngredients] = useState<{ productId: string, quantity: number }[]>([]);

  const { data: products } = useQuery({ queryKey: ["products"], queryFn: () => api.get<any[]>("/api/products") });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post("/api/production/recipes", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production", "recipes"] });
      onClose();
    },
    onError: (err: any) => {
      alert("Failed to save recipe: " + (err.message || "Please check inputs."));
    }
  });

  return (
    <Modal title="New Recipe" open={true} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
        <label className="field-label">Produces Product</label>
        <Select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
          <option value="">Select Product...</option>
          {Array.isArray(products) && products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>

        <label className="field-label">Recipe Name</label>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Standard Mince Recipe" />

        <label className="field-label">Base Yield Quantity</label>
        <Input type="number" value={form.yield} onChange={(e) => setForm({ ...form, yield: Number(e.target.value) })} />

        <h4>Ingredients</h4>
        {ingredients.map((ing, i) => (
          <div key={i} style={{ display: "flex", gap: "10px" }}>
            <Select value={ing.productId} onChange={(e) => {
              const newI = [...ingredients];
              newI[i].productId = e.target.value;
              setIngredients(newI);
            }}>
              <option value="">Select Ingredient...</option>
              {Array.isArray(products) && products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Input type="number" value={ing.quantity} onChange={(e) => {
              const newI = [...ingredients];
              newI[i].quantity = Number(e.target.value);
              setIngredients(newI);
            }} />
            <Button variant="danger" onClick={() => setIngredients(ingredients.filter((_, idx) => idx !== i))}>Remove</Button>
          </div>
        ))}
        <Button variant="secondary" onClick={() => setIngredients([...ingredients, { productId: "", quantity: 1 }])}>Add Ingredient</Button>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px" }}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => createMutation.mutate({ ...form, ingredients })} disabled={createMutation.isPending || !form.productId || !form.name || ingredients.length === 0 || ingredients.some(i => !i.productId || i.quantity <= 0)}>
          Save Recipe
        </Button>
      </div>
    </Modal>
  );
}

function RunModal({ onClose, recipes }: { onClose: () => void, recipes: any[] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ recipeId: "", outputQty: 1, branchId: "", warehouseId: "" });
  
  const { data: branches } = useQuery({ queryKey: ["branches"], queryFn: () => api.get<any[]>("/api/branches") });
  const { data: warehouses } = useQuery({ 
    queryKey: ["warehouses", form.branchId], 
    queryFn: () => api.get<any[]>(`/api/branches/${form.branchId}/warehouses`),
    enabled: !!form.branchId
  });

  const runMutation = useMutation({
    mutationFn: (data: any) => api.post("/api/production/runs", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production", "runs"] });
      qc.invalidateQueries({ queryKey: ["inventory", "stock"] });
      onClose();
    },
    onError: (err: any) => {
      alert("Failed to start run: " + (err.message || "Please check inputs."));
    }
  });

  return (
    <Modal title="Start Production Run" open={true} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
        
        <label className="field-label">Branch</label>
        <Select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
          <option value="">Select Branch...</option>
          {Array.isArray(branches) && branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>

        <label className="field-label">Warehouse</label>
        <Select value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}>
          <option value="">Select Warehouse...</option>
          {Array.isArray(warehouses) && warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>

        <label className="field-label">Recipe</label>
        <Select value={form.recipeId} onChange={(e) => setForm({ ...form, recipeId: e.target.value })}>
          <option value="">Select Recipe...</option>
          {Array.isArray(recipes) && recipes.map(r => <option key={r.id} value={r.id}>{r.name} (yields {r.product?.name})</option>)}
        </Select>

        <label className="field-label">Target Output Quantity</label>
        <Input type="number" value={form.outputQty} onChange={(e) => setForm({ ...form, outputQty: Number(e.target.value) })} />

      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px" }}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => runMutation.mutate(form)} disabled={runMutation.isPending || !form.recipeId || !form.warehouseId}>
          Execute Run
        </Button>
      </div>
    </Modal>
  );
}
