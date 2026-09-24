import { useState, useMemo, useEffect } from "react";
import { Card, Input, Field, Button, fmtMoney, fmtQty } from "../components/ui";

const CARCASS_TYPES = {
  "BEEF_FULL": {
    name: "Full Beast (Beef)",
    cuts: [
      { name: "Fillet", yield: 1.5 },
      { name: "Rump", yield: 3.0 },
      { name: "T-Bone / Sirloin", yield: 4.0 },
      { name: "Topside", yield: 5.0 },
      { name: "Silverside", yield: 5.0 },
      { name: "Chuck", yield: 8.0 },
      { name: "Brisket", yield: 6.0 },
      { name: "Blade", yield: 5.0 },
      { name: "Short Rib", yield: 4.0 },
      { name: "Stewing Beef", yield: 12.0 },
      { name: "Mince / Fat", yield: 8.0 },
      { name: "Bones", yield: 35.0 },
      { name: "Shrinkage / Loss", yield: 3.5 },
    ]
  },
  "BEEF_FORE": {
    name: "Forequarter (Beef)",
    cuts: [
      { name: "Chuck", yield: 12.0 },
      { name: "Brisket", yield: 10.0 },
      { name: "Blade", yield: 8.0 },
      { name: "Short Rib", yield: 6.0 },
      { name: "Stewing Beef / Trimmings", yield: 15.0 },
      { name: "Bones", yield: 45.0 },
      { name: "Shrinkage / Loss", yield: 4.0 },
    ]
  },
  "BEEF_HIND": {
    name: "Hindquarter (Beef)",
    cuts: [
      { name: "Fillet", yield: 3.0 },
      { name: "Rump", yield: 6.0 },
      { name: "T-Bone / Sirloin", yield: 8.0 },
      { name: "Topside", yield: 10.0 },
      { name: "Silverside", yield: 10.0 },
      { name: "Shin", yield: 4.0 },
      { name: "Trimmings", yield: 10.0 },
      { name: "Fat", yield: 10.0 },
      { name: "Bones", yield: 36.0 },
      { name: "Shrinkage / Loss", yield: 3.0 },
    ]
  }
};

export default function Blocktest() {
  const [carcassType, setCarcassType] = useState("BEEF_FULL");
  const [totalWeight, setTotalWeight] = useState<number | "">("");
  const [totalCost, setTotalCost] = useState<number | "">("");
  
  const [rawProductId, setRawProductId] = useState("");
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [productMappings, setProductMappings] = useState<Record<string, string>>({});
  
  const [products, setProducts] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetch("/api/inventory/stock?pageSize=1000", {
      headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }
    })
      .then(r => r.json())
      .then(d => {
        if (d.items) {
          // Flatten items from stock balance to distinct products
          const uniqueProducts = Array.from(new Map(d.items.map((i: any) => [i.product.id, i.product])).values());
          setProducts(uniqueProducts as any[]);
        }
      });
  }, []);

  const data = CARCASS_TYPES[carcassType as keyof typeof CARCASS_TYPES];

  const results = useMemo(() => {
    const weight = Number(totalWeight) || 0;
    const cost = Number(totalCost) || 0;
    
    let totalRevenue = 0;
    const rows = data.cuts.map(cut => {
      const estWeight = (cut.yield / 100) * weight;
      const estCost = (cut.yield / 100) * cost;
      
      const mappedProductId = productMappings[cut.name];
      const mappedProduct = products.find(p => p.id === mappedProductId);
      
      // Inherit selling price from product if not overridden
      const defaultSellingPrice = mappedProduct?.sellingPrice || 0;
      const sellingPrice = prices[cut.name] !== undefined ? prices[cut.name] : defaultSellingPrice;
      
      const expectedRevenue = estWeight * sellingPrice;
      totalRevenue += expectedRevenue;
      
      let gp = 0;
      if (expectedRevenue > 0) {
        gp = ((expectedRevenue - estCost) / expectedRevenue) * 100;
      }

      return {
        ...cut,
        estWeight,
        estCost,
        sellingPrice,
        expectedRevenue,
        gp,
        productId: mappedProductId
      };
    });

    const gpPerc = totalRevenue > 0 ? ((totalRevenue - cost) / totalRevenue) * 100 : 0;
    const markupPerc = cost > 0 ? ((totalRevenue - cost) / cost) * 100 : 0;

    return { rows, totalRevenue, totalCost: cost, gpPerc, markupPerc };
  }, [carcassType, totalWeight, totalCost, prices, productMappings, data.cuts, products]);

  const handlePriceChange = (name: string, val: string) => {
    setPrices(p => ({ ...p, [name]: parseFloat(val) || 0 }));
  };
  
  const handleMappingChange = (name: string, val: string) => {
    setProductMappings(p => ({ ...p, [name]: val }));
  };

  const handleSave = async () => {
    if (!rawProductId) return alert("Please select the raw material (carcass) from inventory.");
    if (!totalWeight || !totalCost) return alert("Please enter weight and cost.");
    
    setIsSaving(true);
    try {
      const payload = {
         rawProductId,
         carcassType,
         rawWeight: Number(totalWeight),
         rawCost: Number(totalCost),
         totalRevenue: results.totalRevenue,
         gpPerc: results.gpPerc,
         markupPerc: results.markupPerc,
         lines: results.rows.map(r => ({
           productId: r.productId || null,
           cutName: r.name,
           yieldPerc: r.yield,
           estWeight: r.estWeight,
           estCost: r.estCost,
           sellingPrice: r.sellingPrice,
           expectedRevenue: r.expectedRevenue,
           gpPerc: r.gp
         }))
      };
      
      const res = await fetch("/api/inventory/blocktests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("token")}`
        },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to save blocktest");
      }
      
      alert("Blocktest saved successfully! Inventory has been updated.");
      setTotalWeight("");
      setTotalCost("");
      setPrices({});
      setRawProductId("");
      
    } catch (e: any) {
      alert("Error: " + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Butchery Blocktest</h1>
          <div className="page-subtitle">Calculate yields, cost allocations, margins, and update inventory.</div>
        </div>
        <div>
          <Button onClick={handleSave} disabled={isSaving || !rawProductId || !totalWeight}>{isSaving ? "Saving..." : "Save & Post to Inventory"}</Button>
        </div>
      </div>

      <div className="form-row-3" style={{ marginBottom: 24 }}>
        <Field label="Carcass Type">
          <select className="input" value={carcassType} onChange={e => { setCarcassType(e.target.value); setPrices({}); }}>
            {Object.entries(CARCASS_TYPES).map(([k, v]) => (
              <option key={k} value={k}>{v.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Raw Material Product (from Inventory)">
          <select className="input" value={rawProductId} onChange={e => setRawProductId(e.target.value)}>
             <option value="">-- Select Raw Material --</option>
             {products.map(p => (
               <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
             ))}
          </select>
        </Field>
      </div>
      <div className="form-row-3" style={{ marginBottom: 24 }}>
        <Field label="Total Carcass Weight (kg)">
          <Input type="number" min={0} value={totalWeight} onChange={e => setTotalWeight(parseFloat(e.target.value) || "")} />
        </Field>
        <Field label="Total Carcass Cost ($)">
          <Input type="number" min={0} value={totalCost} onChange={e => setTotalCost(parseFloat(e.target.value) || "")} />
        </Field>
      </div>

      <Card>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Cut / Category</th>
                <th>Map to Inventory Product</th>
                <th className="num">Yield %</th>
                <th className="num">Est. Weight (kg)</th>
                <th className="num">Cost Alloc. ($)</th>
                <th className="num" style={{ width: 120 }}>Selling Price / kg</th>
                <th className="num">Revenue ($)</th>
                <th className="num">GP %</th>
              </tr>
            </thead>
            <tbody>
              {results.rows.map(r => (
                <tr key={r.name}>
                  <td style={{ fontWeight: 500 }}>{r.name}</td>
                  <td>
                    {!r.name.toLowerCase().includes("loss") && !r.name.toLowerCase().includes("bones") ? (
                       <select className="input" style={{ padding: '4px 8px', fontSize: 13, height: 32 }} value={r.productId || ""} onChange={e => handleMappingChange(r.name, e.target.value)}>
                         <option value="">-- No mapping --</option>
                         {products.map(p => (
                           <option key={p.id} value={p.id}>{p.name}</option>
                         ))}
                       </select>
                    ) : <span style={{color: 'var(--gray-5)'}}>N/A</span>}
                  </td>
                  <td className="num">{r.yield.toFixed(1)}%</td>
                  <td className="num">{fmtQty(r.estWeight)}</td>
                  <td className="num">{fmtMoney(r.estCost)}</td>
                  <td className="num">
                    {!r.name.toLowerCase().includes("loss") && !r.name.toLowerCase().includes("bones") ? (
                       <Input 
                         type="number" 
                         min={0} 
                         style={{ textAlign: "right", height: 32 }}
                         value={prices[r.name] !== undefined ? prices[r.name] : (r.sellingPrice || "")} 
                         onChange={e => handlePriceChange(r.name, e.target.value)} 
                         placeholder="0.00"
                       />
                    ) : "—"}
                  </td>
                  <td className="num">{fmtMoney(r.expectedRevenue)}</td>
                  <td className="num">
                    <span style={{ color: r.gp < 0 ? 'var(--red-6)' : (r.gp > 0 ? 'var(--green-6)' : 'inherit') }}>
                      {r.expectedRevenue > 0 ? r.gp.toFixed(1) + "%" : "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600, backgroundColor: 'var(--gray-0)' }}>
                <td colSpan={2}>TOTALS</td>
                <td className="num">100%</td>
                <td className="num">{fmtQty(Number(totalWeight) || 0)} kg</td>
                <td className="num">{fmtMoney(results.totalCost)}</td>
                <td className="num">—</td>
                <td className="num">{fmtMoney(results.totalRevenue)}</td>
                <td className="num">
                  <span style={{ color: results.gpPerc < 0 ? 'var(--red-6)' : (results.gpPerc > 0 ? 'var(--green-6)' : 'inherit') }}>
                    {results.totalRevenue > 0 ? results.gpPerc.toFixed(1) + "%" : "—"}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {results.totalCost > 0 && results.totalRevenue > 0 && (
        <div style={{ marginTop: 24, display: 'flex', gap: 24 }}>
          <Card style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: 'var(--gray-5)', marginBottom: 4 }}>Overall Target GP %</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: results.gpPerc > 25 ? 'var(--green-6)' : 'var(--orange-6)' }}>
              {results.gpPerc.toFixed(2)}%
            </div>
          </Card>
          <Card style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: 'var(--gray-5)', marginBottom: 4 }}>Overall Markup %</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--blue-6)' }}>
              {results.markupPerc.toFixed(2)}%
            </div>
          </Card>
          <Card style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: 'var(--gray-5)', marginBottom: 4 }}>Expected Profit</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: (results.totalRevenue - results.totalCost) >= 0 ? 'var(--green-6)' : 'var(--red-6)' }}>
              {fmtMoney(results.totalRevenue - results.totalCost)}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
