export interface CurrentUser {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  branchId: string | null;
  companyId: string;
  canViewAllBranches: boolean;
  mustChangePassword?: boolean;
  roles: string[];
  permissions: string[];
}

export interface LoginResponse {
  token: string;
  user: CurrentUser;
}

export interface Branch {
  id: string;
  code: string;
  name: string;
  status?: string;
}

export interface Warehouse {
  id: string;
  branchId: string;
  name: string;
  isDefault?: boolean;
}

export interface Department {
  id: string;
  code: string;
  name: string;
  defaultMarkup?: string | number | null;
  defaultGp?: string | number | null;
}

export interface Product {
  id: string;
  sku: string;
  barcode?: string | null;
  name: string;
  type?: string;
  sellingPrice: string | number;
  wholesalePrice?: string | number | null;
  retailPrice?: string | number | null;
  costPrice?: string | number | null;
  reorderLevel?: string | number | null;
  isPosFeatured?: boolean;
  posColor?: string | null;
  departmentId?: string | null;
  department?: Department | null;
  markup?: string | number | null;
  gp?: string | number | null;
}

export interface Customer {
  id: string;
  code?: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  balance?: number;
  totalBilled?: number;
  totalPaid?: number;
  outstandingAmount?: number;
}

export interface Shift {
  id: string;
  status: string;
  openingFloat: number;
  countedCash?: number | null;
  expectedCash?: number | null;
  variance?: number | null;
  openedAt: string;
  closedAt?: string | null;
  sales?: Array<{ id: string; reference: string; total: number; saleDate: string; paymentMethod?: string | null }>;
  events?: Array<{ id: string; type: string; amount: number; note?: string | null; createdAt: string }>;
}