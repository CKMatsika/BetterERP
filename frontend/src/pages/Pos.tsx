import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, Trash2, ShoppingCart } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Input, Field, Modal, Spinner, EmptyState } from "../components/ui";
import { fmtMoney, fmtDateTime } from "../lib/format";
import type { Product, Shift } from "../api/types";

interface CartLine {
  product: Product;
  quantity: number;
  price: number;
}

interface MyShiftRes {
  shift: Shift | null;
  cashSummary?: { cashSales: number; cashDrops: number; expenses: number; expectedCash: number };
}
interface CurrencyOption { id: string; code: string; name: string; symbol: string; isBase: boolean; exchangeRates: Array<{ rateToBase: number }> }
interface PaymentRow { method: string; currency: string; amount: string }

function numberValue(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

export default function Pos() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [openShiftOpen, setOpenShiftOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [payments, setPayments] = useState<PaymentRow[]>([{ method: "CASH", currency: "USD", amount: "" }]);
  const [floatStr, setFloatStr] = useState("0");
  const [paymentCurrency] = useState("USD");
  const [cashUpOpen, setCashUpOpen] = useState(false);
  const [countedCash, setCountedCash] = useState("");
  const [varianceNotes, setVarianceNotes] = useState("");

  const shiftQ = useQuery({ queryKey: ["pos", "my-open"], queryFn: () => api.get<MyShiftRes>("/api/misc/pos-shifts/my-open") });
  const currencies = useQuery({ queryKey: ["pos", "currencies"], queryFn: () => api.get<{ items: CurrencyOption[] }>("/api/tax/currencies") });
  const searchQ = useQuery({
    queryKey: ["product", "search", search],
    queryFn: () => api.get<{ items: Product[] }>("/api/products/search", { q: search, limit: 40 }),
    enabled: search.length >= 2,
    placeholderData: (prev) => prev,
  });

  const openShift = useMutation({
    mutationFn: (body: { openingFloat: number; terminal?: string }) => api.post<Shift>("/api/misc/pos-shifts/open", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pos", "my-open"] });
      setOpenShiftOpen(false);
    },
  });

  const closeShift = useMutation({
    mutationFn: () => api.post<Shift>(`/api/misc/pos-shifts/${shiftQ.data?.shift?.id}/close`, {
      countedCash: parseFloat(countedCash),
      varianceNotes: varianceNotes || undefined,
    }),
    onSuccess: () => {
      setCashUpOpen(false);
      setCountedCash("");
      setVarianceNotes("");
      qc.invalidateQueries({ queryKey: ["pos", "my-open"] });
    },
  });

  const checkout = useMutation({
    mutationFn: () =>
      api.post("/api/sales", {
        type: "POS",
        shiftId: shiftQ.data?.shift?.id ?? null,
        lines: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity, unitPrice: l.price })),
        payments: payments.map((payment) => {
          const currency = currencies.data?.items.find((item) => item.code === payment.currency);
          const rate = currency?.isBase ? 1 : Number(currency?.exchangeRates[0]?.rateToBase ?? 0);
          return { method: payment.method, amount: parseFloat(payment.amount) || 0, currency: payment.currency, exchangeRate: rate };
        }),
      }),
    onSuccess: () => {
      setCart([]);
      setPayments([{ method: "CASH", currency: "USD", amount: "" }]);
      setCheckoutOpen(false);
      qc.invalidateQueries({ queryKey: ["pos", "my-open"] });
      qc.invalidateQueries({ queryKey: ["product", "search"] });
    },
  });

  const shift = shiftQ.data?.shift ?? null;

  const total = useMemo(() => cart.reduce((acc, l) => acc + l.price * l.quantity, 0), [cart]);
  const selectedCurrency = currencies.data?.items.find((currency) => currency.code === paymentCurrency);
  const currencyRate = selectedCurrency?.isBase ? 1 : Number(selectedCurrency?.exchangeRates[0]?.rateToBase ?? 0);
  const currencyTotal = currencyRate > 0 ? total / currencyRate : total;
  const paymentBaseTotal = payments.reduce((sum, payment) => {
    const currency = currencies.data?.items.find((item) => item.code === payment.currency);
    const rate = currency?.isBase ? 1 : Number(currency?.exchangeRates[0]?.rateToBase ?? 0);
    return sum + (rate > 0 ? (parseFloat(payment.amount) || 0) * rate : 0);
  }, 0);
  const paymentsComplete = paymentBaseTotal >= total && payments.every((payment) => parseFloat(payment.amount) > 0);

  const addProduct = (p: Product) => {
    const price = numberValue(p.sellingPrice) || numberValue(p.retailPrice) || 0;
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === p.id);
      if (existing) {
        return prev.map((l) => (l.product.id === p.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { product: p, quantity: 1, price }];
    });
  };

  const setQty = (id: string, qty: number) => setCart((prev) => prev.map((l) => (l.product.id === id ? { ...l, quantity: Math.max(0.01, qty) } : l)).filter((l) => l.quantity > 0));
  const removeLine = (id: string) => setCart((prev) => prev.filter((l) => l.product.id !== id));

  if (shiftQ.isLoading) return <Spinner label="Loading POS…" />;

  if (!shift) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Point of Sale</h1>
            <div className="page-subtitle">Open a shift to start selling on your assigned branch.</div>
          </div>
        </div>
        <Card>
          <EmptyState text="You don't have an open shift yet." />
          <div style={{ textAlign: "center", marginBottom: 18 }}>
            <Button onClick={() => setOpenShiftOpen(true)}>Open shift</Button>
          </div>
        </Card>

        <Modal
          title="Open shift"
          open={openShiftOpen}
          onClose={() => setOpenShiftOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpenShiftOpen(false)}>Cancel</Button>
              <Button
                disabled={openShift.isPending}
                onClick={() => openShift.mutate({ openingFloat: parseFloat(floatStr) || 0, terminal: user?.fullName })}
              >
                Open
              </Button>
            </>
          }
        >
          <Field label="Opening float (cash in till)">
            <Input type="number" min={0} value={floatStr} step="0.01" placeholder="0.00" onChange={(e) => setFloatStr(e.target.value)} />
          </Field>
          {openShift.isError && <div className="login-error">{(openShift.error as Error).message}</div>}
        </Modal>
      </div>
    );
  }

  return (
    <div className="pos-layout">
      <div className="pos-products">
        <form className="pos-search" onSubmit={(e) => e.preventDefault()}>
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, SKU or barcode… (min 2 characters)"
          />
        </form>
        {search.length < 2 ? (
          <EmptyState text="Type at least 2 characters to search products." />
        ) : searchQ.isLoading ? (
          <Spinner />
        ) : searchQ.data?.items.length === 0 ? (
          <EmptyState text="No products match your search." />
        ) : (
          <div className="product-grid">
            {searchQ.data!.items.map((p) => (
              <button key={p.id} className="product-tile" onClick={() => addProduct(p)}>
                <div className="p-name">{p.name}</div>
                <div className="p-sku">{p.sku}{p.barcode ? ` • ${p.barcode}` : ""}</div>
                <div className="p-price">{fmtMoney(numberValue(p.sellingPrice) || numberValue(p.retailPrice))}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pos-cart">
        <Card title={`Shift ${shift.status} — opened ${fmtDateTime(shift.openedAt)}`} style={{ borderRadius: 0 }} className="pos-cart-body">
          {cart.length === 0 ? (
            <EmptyState text="Cart is empty. Tap products to add them." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Line</th><th /></tr></thead>
                <tbody>
                  {cart.map((l) => (
                    <tr key={l.product.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{l.product.name}</div>
                        <div className="muted" style={{ fontSize: 11.5 }}>{l.product.sku}</div>
                      </td>
                      <td className="num" style={{ whiteSpace: "nowrap" }}>
                        <span className="hstack" style={{ justifyContent: "flex-end", gap: 2 }}>
                          <Button size="sm" variant="ghost" className="icon-btn" onClick={() => setQty(l.product.id, l.quantity - 1)}><Minus size={13} /></Button>
                          <Input type="number" value={l.quantity} min={1} step={1} onChange={(e) => setQty(l.product.id, parseFloat(e.target.value) || 1)} style={{ width: 64, padding: "3px 6px", textAlign: "right" }} />
                          <Button size="sm" variant="ghost" className="icon-btn" onClick={() => setQty(l.product.id, l.quantity + 1)}><Plus size={13} /></Button>
                        </span>
                      </td>
                      <td className="num">{fmtMoney(l.price)}</td>
                      <td className="num">{fmtMoney(l.price * l.quantity)}</td>
                      <td className="right">
                        <Button size="sm" variant="ghost" className="icon-btn" onClick={() => removeLine(l.product.id)}><Trash2 size={13} /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="pos-totals">
          <div className="total-row"><span>Items</span><span>{cart.reduce((a, l) => a + l.quantity, 0)}</span></div>
          <div className="total-row grand"><span>Total</span><span>{fmtMoney(total)}</span></div>
          <div className="mt-2">
            <Button disabled={cart.length === 0} style={{ width: "100%" }} onClick={() => { setPayments([{ method: "CASH", currency: paymentCurrency, amount: String(Math.round(currencyTotal * 100) / 100) }]); setCheckoutOpen(true); }}>
              <ShoppingCart size={15} /> Checkout ({fmtMoney(total)})
            </Button>
          </div>
        </div>
        <div style={{ padding: "0 16px 16px" }}>
          <Button variant="secondary" style={{ width: "100%" }} onClick={() => { setCountedCash(String(shiftQ.data?.cashSummary?.expectedCash ?? 0)); setCashUpOpen(true); }}>
            Day end / cash-up
          </Button>
        </div>
      </div>

      <Modal
        title="Checkout — split payments"
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCheckoutOpen(false)}>Cancel</Button>
            <Button disabled={checkout.isPending || !paymentsComplete} onClick={() => checkout.mutate()}>
              {checkout.isPending ? "Posting…" : "Complete sale"}
            </Button>
          </>
        }
      >
        <div className="stack">
          <div className="total-row grand"><span>Total due (USD base)</span><span>{fmtMoney(total)}</span></div>
          <div className="table-wrap"><table className="table"><thead><tr><th>Method</th><th>Currency</th><th>Amount</th><th /></tr></thead><tbody>{payments.map((payment, index) => <tr key={index}><td><select className="input" value={payment.method} onChange={(e) => setPayments((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, method: e.target.value } : item))}><option value="CASH">Cash</option><option value="CARD">Card</option><option value="BANK_TRANSFER">Bank transfer</option><option value="ECOCASH">EcoCash</option><option value="ONEMONEY">OneMoney</option><option value="ZIPIT">ZIPIT</option></select></td><td><select className="input" value={payment.currency} onChange={(e) => setPayments((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, currency: e.target.value } : item))}><option value="USD">USD</option>{currencies.data?.items.filter((currency) => currency.code !== "USD").map((currency) => <option key={currency.code} value={currency.code}>{currency.code}</option>)}</select></td><td><Input type="number" min={0} step="0.01" value={payment.amount} onChange={(e) => setPayments((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, amount: e.target.value } : item))} /></td><td><Button size="sm" variant="ghost" onClick={() => setPayments((previous) => previous.length > 1 ? previous.filter((_, itemIndex) => itemIndex !== index) : previous)}>Remove</Button></td></tr>)}</tbody></table></div>
          <Button variant="secondary" size="sm" onClick={() => setPayments((previous) => [...previous, { method: "CASH", currency: "USD", amount: "" }])}>Add payment</Button>
          <div className="total-row"><span>Payments converted to USD</span><span>{fmtMoney(paymentBaseTotal)}</span></div>
          {paymentBaseTotal >= total && <div className="total-row grand"><span>Change / excess (USD)</span><span>{fmtMoney(paymentBaseTotal - total)}</span></div>}
          {checkout.isError && <div className="login-error">{(checkout.error as Error).message}</div>}
        </div>
      </Modal>

      <Modal
        title="Day end cash-up"
        open={cashUpOpen}
        onClose={() => setCashUpOpen(false)}
        footer={<>
          <Button variant="secondary" onClick={() => setCashUpOpen(false)}>Cancel</Button>
          <Button variant="danger" disabled={closeShift.isPending || countedCash === ""} onClick={() => closeShift.mutate()}>
            {closeShift.isPending ? "Closing…" : "Close shift"}
          </Button>
        </>}
      >
        <div className="stack">
          <div className="total-row"><span>Opening float</span><span>{fmtMoney(shift.openingFloat)}</span></div>
          <div className="total-row"><span>Cash sales</span><span>{fmtMoney(shiftQ.data?.cashSummary?.cashSales ?? 0)}</span></div>
          <div className="total-row"><span>Cash drops</span><span>- {fmtMoney(shiftQ.data?.cashSummary?.cashDrops ?? 0)}</span></div>
          <div className="total-row grand"><span>Expected cash</span><span>{fmtMoney(shiftQ.data?.cashSummary?.expectedCash ?? 0)}</span></div>
          <Field label="Actual cash counted *"><Input type="number" min={0} step="0.01" value={countedCash} onChange={(e) => setCountedCash(e.target.value)} /></Field>
          <Field label="Variance note"><Input value={varianceNotes} onChange={(e) => setVarianceNotes(e.target.value)} placeholder="Required for unexplained differences" /></Field>
          {closeShift.isError && <div className="login-error">{(closeShift.error as Error).message}</div>}
        </div>
      </Modal>
    </div>
  );
}