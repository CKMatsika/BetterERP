import { useState, useEffect } from "react";
import { Card, Input, Field, Button, PageHeader, Modal } from "../components/ui";

export default function StockCounts() {
  const [counts, setCounts] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [warehouseId, setWarehouseId] = useState("");
  
  const [lines, setLines] = useState<any[]>([]);

  useEffect(() => {
    fetchCounts();
    fetch("/api/inventory/stock?pageSize=1000", {
      headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }
    })
      .then(r => r.json())
      .then(d => {
        if (d.items) {
          const uniqueProducts = Array.from(new Map(d.items.map((i: any) => [i.product.id, i.product])).values());
          setProducts(uniqueProducts as any[]);
          if (d.items[0]?.warehouseId) setWarehouseId(d.items[0].warehouseId);
        }
      });
  }, []);

  const fetchCounts = async () => {
    const res = await fetch("/api/inventory/counts?pageSize=50", {
      headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }
    });
    if (res.ok) {
      const data = await res.json();
      setCounts(data.items || []);
    }
  };

  const handleAddLine = () => {
    setLines([...lines, { productId: "", countedQty: "", locationId: "" }]);
  };

  const handleSave = async () => {
    try {
      const payload = {
        warehouseId,
        note: "Stock Take",
        lines: lines.map(l => ({
          productId: l.productId,
          countedQty: Number(l.countedQty),
          locationId: l.locationId || null
        }))
      };
      const res = await fetch("/api/inventory/counts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("token")}`
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to post stock count");
      alert("Stock count posted successfully");
      setShowNew(false);
      fetchCounts();
    } catch (e: any) {
      alert("Error: " + e.message);
    }
  };

  return (
    <div>
      <PageHeader
        title="Stock Counts (Stock Take)"
        subtitle="Perform physical inventory counts by location."
        actions={<Button onClick={() => { setLines([]); setShowNew(true); }}>New Stock Count</Button>}
      />

      <Card>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Reference</th>
              <th>Warehouse</th>
              <th>Note</th>
              <th>Status</th>
              <th>Lines</th>
            </tr>
          </thead>
          <tbody>
            {counts.map(c => (
              <tr key={c.id}>
                <td>{new Date(c.countDate).toLocaleString()}</td>
                <td>{c.reference}</td>
                <td>{c.warehouse?.name}</td>
                <td>{c.note}</td>
                <td><span className="badge badge-green">{c.status}</span></td>
                <td>{c.lines?.length || 0}</td>
              </tr>
            ))}
            {counts.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: 24, color: "var(--gray-5)" }}>
                  No stock counts found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {showNew && (
        <Modal title="New Stock Count" open={true} onClose={() => setShowNew(false)}>
          <div style={{ marginBottom: 16 }}>
            <p style={{ color: "var(--gray-5)", fontSize: 13, marginBottom: 16 }}>
              Enter the actual physical quantities you have counted for each product. 
              You can optionally record the specific Location (e.g. Fridge A, Chiller 2) where the stock was counted.
            </p>
            <Field label="Warehouse ID">
               <Input value={warehouseId} onChange={e => setWarehouseId(e.target.value)} placeholder="Default Warehouse ID" />
            </Field>
          </div>
          
          <table className="table" style={{ marginBottom: 16 }}>
             <thead>
               <tr>
                 <th>Product</th>
                 <th>Location (Optional)</th>
                 <th>Counted Qty</th>
                 <th></th>
               </tr>
             </thead>
             <tbody>
               {lines.map((l, i) => (
                 <tr key={i}>
                   <td>
                     <select className="input" value={l.productId} onChange={e => {
                       const newLines = [...lines];
                       newLines[i].productId = e.target.value;
                       setLines(newLines);
                     }}>
                       <option value="">Select Product...</option>
                       {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                     </select>
                   </td>
                   <td>
                     <Input value={l.locationId} onChange={e => {
                       const newLines = [...lines];
                       newLines[i].locationId = e.target.value;
                       setLines(newLines);
                     }} placeholder="e.g. Chiller 1" />
                   </td>
                   <td>
                     <Input type="number" value={l.countedQty} onChange={e => {
                       const newLines = [...lines];
                       newLines[i].countedQty = e.target.value;
                       setLines(newLines);
                     }} placeholder="0" />
                   </td>
                   <td>
                     <Button variant="secondary" onClick={() => {
                        const newLines = [...lines];
                        newLines.splice(i, 1);
                        setLines(newLines);
                     }}>X</Button>
                   </td>
                 </tr>
               ))}
             </tbody>
          </table>
          
          <Button variant="secondary" onClick={handleAddLine} style={{ marginBottom: 24 }}>+ Add Product to Count</Button>
          
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={lines.length === 0 || !warehouseId || lines.some(l => !l.productId || l.countedQty === "")}>
              Post Stock Take
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
