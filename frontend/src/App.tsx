import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { Spinner } from "./components/ui";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Pos from "./pages/Pos";
import Sales from "./pages/Sales";
import Customers from "./pages/Customers";
import Products from "./pages/Products";
import Stock from "./pages/Stock";
import Adjustments from "./pages/Adjustments";
import Transfers from "./pages/Transfers";
import Blocktest from "./pages/Blocktest";
import StockCounts from "./pages/StockCounts";
import ProductionRuns from "./pages/ProductionRuns";
import PurchaseOrders from "./pages/PurchaseOrders";
import GoodsReceipts from "./pages/GoodsReceipts";
import SupplierInvoices from "./pages/SupplierInvoices";
import PurchaseReturns from "./pages/PurchaseReturns";
import Imports from "./pages/Imports";
import SalesDocuments from "./pages/SalesDocuments";
import Suppliers from "./pages/Suppliers";
import Accounting from "./pages/Accounting";
import Expenses from "./pages/Expenses";
import Hr from "./pages/Hr";
import Payroll from "./pages/Payroll";
import Approvals from "./pages/Approvals";
import Reports from "./pages/Reports";
import Users from "./pages/Users";
import Settings from "./pages/Settings";
import Assets from "./pages/Assets";
import Banking from "./pages/Banking";
import ChangePassword from "./pages/ChangePassword";
import NotFound from "./pages/NotFound";

function Shield({ perm, children }: { perm: string; children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.permissions.includes(perm)) return <>{children}</>;
  return <Navigate to="/dashboard" replace />;
}

function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="login-wrap">
        <Spinner label="Loading…" />
      </div>
    );
  }

  if (!user) return <Login />;
  if (user.mustChangePassword) return <ChangePassword />;

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/dashboard" replace />} />
      <Route element={<Layout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/pos" element={<Shield perm="pos.view"><Pos /></Shield>} />
        <Route path="/sales" element={<Shield perm="sale.view"><Sales /></Shield>} />
        <Route path="/sales/documents" element={<Shield perm="sale.view"><SalesDocuments /></Shield>} />
        <Route path="/customers" element={<Shield perm="customer.view"><Customers /></Shield>} />
        <Route path="/inventory/products" element={<Shield perm="product.view"><Products /></Shield>} />
        <Route path="/inventory/stock" element={<Shield perm="inventory.view"><Stock /></Shield>} />
        <Route path="/inventory/counts" element={<Shield perm="inventory.count"><StockCounts /></Shield>} />
        <Route path="/inventory/adjustments" element={<Shield perm="inventory.adjust"><Adjustments /></Shield>} />
        <Route path="/inventory/transfers" element={<Shield perm="transfer.view"><Transfers /></Shield>} />
        <Route path="/inventory/blocktest" element={<Shield perm="product.view"><Blocktest /></Shield>} />
        <Route path="/inventory/production" element={<Shield perm="product.view"><ProductionRuns /></Shield>} />
        <Route path="/purchasing/orders" element={<Shield perm="purchase.view"><PurchaseOrders /></Shield>} />
        <Route path="/purchasing/suppliers" element={<Shield perm="supplier.view"><Suppliers /></Shield>} />
        <Route path="/purchasing/receipts" element={<Shield perm="purchase.view"><GoodsReceipts /></Shield>} />
        <Route path="/purchasing/invoices" element={<Shield perm="purchase.view"><SupplierInvoices /></Shield>} />
        <Route path="/purchasing/returns" element={<Shield perm="purchase.view"><PurchaseReturns /></Shield>} />
        <Route path="/accounting" element={<Shield perm="accounting.view"><Accounting /></Shield>} />
        <Route path="/expenses" element={<Shield perm="expense.view"><Expenses /></Shield>} />
        <Route path="/assets" element={<Shield perm="asset.view"><Assets /></Shield>} />
        <Route path="/banking" element={<Shield perm="bank.view"><Banking /></Shield>} />
        <Route path="/hr" element={<Shield perm="employee.view"><Hr /></Shield>} />
        <Route path="/payroll" element={<Shield perm="payroll.view"><Payroll /></Shield>} />
        <Route path="/approvals" element={<Shield perm="approval.view"><Approvals /></Shield>} />
        <Route path="/reports" element={<Shield perm="report.view"><Reports /></Shield>} />
        <Route path="/users" element={<Shield perm="user.view"><Users /></Shield>} />
        <Route path="/settings" element={<Shield perm="setting.view"><Settings /></Shield>} />
        <Route path="/imports" element={<Shield perm="product.import"><Imports /></Shield>} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default App;