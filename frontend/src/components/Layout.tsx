import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button } from "./ui";
import { LogOut, Boxes, LayoutDashboard, ShoppingCart, Users, Package, Warehouse, ArrowLeftRight, ClipboardList, Truck, FileSpreadsheet, Calculator, ReceiptText, Briefcase, HardHat, BadgeCheck, BarChart3, UserCog, Settings as SettingsIcon } from "lucide-react";

interface NavLeaf {
  label: string;
  to: string;
  perm: string;
}
interface NavSection {
  title?: string;
  items: NavLeaf[];
}

const sections: NavSection[] = [
  { items: [{ label: "Dashboard", to: "/dashboard", perm: "dashboard.view" }] },
  {
    title: "Sales & POS",
    items: [
      { label: "Point of Sale", to: "/pos", perm: "pos.view" },
      { label: "Sales", to: "/sales", perm: "sale.view" },
      { label: "Quotes & Orders", to: "/sales/documents", perm: "sale.view" },
      { label: "Customers", to: "/customers", perm: "customer.view" },
    ],
  },
  {
    title: "Inventory",
    items: [
      { label: "Products", to: "/inventory/products", perm: "product.view" },
      { label: "Stock on Hand", to: "/inventory/stock", perm: "inventory.view" },
      { label: "Adjustments", to: "/inventory/adjustments", perm: "inventory.adjust" },
      { label: "Branch Transfers", to: "/inventory/transfers", perm: "transfer.view" },
    ],
  },
  {
    title: "Procurement",
    items: [
      { label: "Purchase Orders", to: "/purchasing/orders", perm: "purchase.view" },
      { label: "Suppliers", to: "/purchasing/suppliers", perm: "supplier.view" },
      { label: "Goods Receipts", to: "/purchasing/receipts", perm: "inventory.receive" },
      { label: "Supplier Invoices", to: "/purchasing/invoices", perm: "purchase.view" },
      { label: "Purchase Returns", to: "/purchasing/returns", perm: "purchase.view" },
    ],
  },
  {
    title: "Finance",
    items: [
      { label: "Accounting", to: "/accounting", perm: "accounting.view" },
      { label: "Expenses", to: "/expenses", perm: "expense.view" },
      { label: "Banking", to: "/banking", perm: "bank.view" },
      { label: "Fixed Assets", to: "/assets", perm: "asset.view" },
    ],
  },
  {
    title: "People",
    items: [
      { label: "HR / Employees", to: "/hr", perm: "employee.view" },
      { label: "Payroll", to: "/payroll", perm: "payroll.view" },
    ],
  },
  {
    title: "Control",
    items: [
      { label: "Approvals", to: "/approvals", perm: "approval.view" },
      { label: "Reports", to: "/reports", perm: "report.view" },
      { label: "Users & Roles", to: "/users", perm: "user.view" },
      { label: "Settings", to: "/settings", perm: "setting.view" },
      { label: "Imports", to: "/imports", perm: "product.import" },
    ],
  },
];

const iconByLabel: Record<string, React.ReactNode> = {
  Dashboard: <LayoutDashboard size={16} />,
  "Point of Sale": <ShoppingCart size={16} />,
  Sales: <ReceiptText size={16} />,
  "Quotes & Orders": <ClipboardList size={16} />,
  Customers: <Users size={16} />,
  Products: <Package size={16} />,
  "Stock on Hand": <Warehouse size={16} />,
  Adjustments: <Boxes size={16} />,
  "Branch Transfers": <ArrowLeftRight size={16} />,
  "Purchase Orders": <ClipboardList size={16} />,
  Suppliers: <Truck size={16} />,
  "Goods Receipts": <Truck size={16} />,
  "Supplier Invoices": <FileSpreadsheet size={16} />,
  "Purchase Returns": <ArrowLeftRight size={16} />,
  Accounting: <Calculator size={16} />,
  Expenses: <ReceiptText size={16} />,
  Banking: <Calculator size={16} />,
  "Fixed Assets": <Briefcase size={16} />,
  "HR / Employees": <HardHat size={16} />,
  Payroll: <BadgeCheck size={16} />,
  Approvals: <BadgeCheck size={16} />,
  Reports: <BarChart3 size={16} />,
  "Users & Roles": <UserCog size={16} />,
  Settings: <SettingsIcon size={16} />,
  Imports: <FileSpreadsheet size={16} />,
};

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const company = useQuery({ queryKey: ["company", "profile"], queryFn: () => api.get<{ name: string; logoUrl: string | null; settings: { primaryColor?: string; accentColor?: string } | null }>("/api/company/profile") });

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--primary", company.data?.settings?.primaryColor ?? "#2563eb");
    root.style.setProperty("--accent", company.data?.settings?.accentColor ?? "#0f766e");
    return () => { root.style.removeProperty("--primary"); root.style.removeProperty("--accent"); };
  }, [company.data]);

  const visible = sections
    .map((s) => ({ ...s, items: s.items.filter((i) => user?.permissions.includes(i.perm)) }))
    .filter((s) => s.items.length > 0);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          {company.data?.logoUrl ? <img className="logo" src={company.data.logoUrl} alt="" /> : <span className="logo">B</span>} {company.data?.name ?? "BetterERP"}
        </div>
        <nav className="sidebar-nav">
          {visible.map((section, i) => (
            <div className="nav-section" key={i}>
              {section.title && <div className="nav-section-title">{section.title}</div>}
              {section.items.map((item) => (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
                  {iconByLabel[item.label]}
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div>{user?.fullName}</div>
          <div className="muted">{user?.roles.join(", ")}</div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-title">{user?.fullName}</div>
          <div className="topbar-right">
            <span className="muted">{user?.username}</span>
            <Button variant="ghost" size="sm" onClick={() => void logout().then(() => navigate("/login"))}>
              <LogOut size={14} /> Log out
            </Button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}