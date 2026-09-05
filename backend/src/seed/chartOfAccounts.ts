export interface AccountSeedDef {
  code: string;
  name: string;
  type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE" | "CONTRA_ASSET" | "CONTRA_REVENUE";
  category: string;
  normalBalance: "DEBIT" | "CREDIT";
  parentCode?: string;
}

// Zimbabwe-oriented default chart of accounts
export const DEFAULT_CHART_OF_ACCOUNTS: AccountSeedDef[] = [
  // ===== ASSETS (1000) =====
  { code: "1000", name: "Assets", type: "ASSET", category: "GROUP", normalBalance: "DEBIT" },
  { code: "1100", name: "Cash on Hand", type: "ASSET", category: "CASH", normalBalance: "DEBIT", parentCode: "1000" },
  { code: "1101", name: "Petty Cash", type: "ASSET", category: "CASH", normalBalance: "DEBIT", parentCode: "1000" },
  { code: "1200", name: "Bank Accounts", type: "ASSET", category: "GROUP", normalBalance: "DEBIT", parentCode: "1000" },
  { code: "1201", name: "Bank - Operating Account", type: "ASSET", category: "BANK", normalBalance: "DEBIT", parentCode: "1200" },
  { code: "1300", name: "Accounts Receivable", type: "ASSET", category: "RECEIVABLE", normalBalance: "DEBIT", parentCode: "1000" },
  { code: "1301", name: "Trade Receivables", type: "ASSET", category: "RECEIVABLE", normalBalance: "DEBIT", parentCode: "1300" },
  { code: "1400", name: "Inventory", type: "ASSET", category: "INVENTORY", normalBalance: "DEBIT", parentCode: "1000" },
  { code: "1401", name: "Inventory - Trading Stock", type: "ASSET", category: "INVENTORY", normalBalance: "DEBIT", parentCode: "1400" },
  { code: "1402", name: "Inventory - In Transit", type: "ASSET", category: "INVENTORY", normalBalance: "DEBIT", parentCode: "1400" },
  { code: "1500", name: "Fixed Assets", type: "ASSET", category: "GROUP", normalBalance: "DEBIT", parentCode: "1000" },
  { code: "1501", name: "Vehicles", type: "ASSET", category: "FIXED_ASSET", normalBalance: "DEBIT", parentCode: "1500" },
  { code: "1502", name: "Equipment", type: "ASSET", category: "FIXED_ASSET", normalBalance: "DEBIT", parentCode: "1500" },
  { code: "1503", name: "Furniture and Fittings", type: "ASSET", category: "FIXED_ASSET", normalBalance: "DEBIT", parentCode: "1500" },
  { code: "1504", name: "Computers and IT", type: "ASSET", category: "FIXED_ASSET", normalBalance: "DEBIT", parentCode: "1500" },
  { code: "1505", name: "Buildings and Land", type: "ASSET", category: "FIXED_ASSET", normalBalance: "DEBIT", parentCode: "1500" },
  { code: "1510", name: "Accumulated Depreciation", type: "CONTRA_ASSET", category: "FIXED_ASSET", normalBalance: "CREDIT", parentCode: "1500" },
  { code: "1600", name: "Other Receivables and Prepayments", type: "ASSET", category: "OTHER", normalBalance: "DEBIT", parentCode: "1000" },
  { code: "1601", name: "VAT Input Receivable", type: "ASSET", category: "TAX", normalBalance: "DEBIT", parentCode: "1000" },
  { code: "1602", name: "Staff Advances", type: "ASSET", category: "OTHER", normalBalance: "DEBIT", parentCode: "1000" },
  { code: "1603", name: "Prepaid Expenses", type: "ASSET", category: "OTHER", normalBalance: "DEBIT", parentCode: "1000" },

  // ===== LIABILITIES (2000) =====
  { code: "2000", name: "Liabilities", type: "LIABILITY", category: "GROUP", normalBalance: "CREDIT" },
  { code: "2100", name: "Accounts Payable", type: "LIABILITY", category: "PAYABLE", normalBalance: "CREDIT", parentCode: "2000" },
  { code: "2101", name: "Trade Payables", type: "LIABILITY", category: "PAYABLE", normalBalance: "CREDIT", parentCode: "2100" },
  { code: "2102", name: "Goods Received Not Invoiced", type: "LIABILITY", category: "PAYABLE", normalBalance: "CREDIT", parentCode: "2100" },
  { code: "2200", name: "Tax Payables", type: "LIABILITY", category: "TAX", normalBalance: "CREDIT", parentCode: "2000" },
  { code: "2201", name: "VAT Output Payable", type: "LIABILITY", category: "TAX", normalBalance: "CREDIT", parentCode: "2200" },
  { code: "2202", name: "PAYE Payable", type: "LIABILITY", category: "TAX", normalBalance: "CREDIT", parentCode: "2200" },
  { code: "2203", name: "NSSA Payable", type: "LIABILITY", category: "TAX", normalBalance: "CREDIT", parentCode: "2200" },
  { code: "2300", name: "Other Liabilities", type: "LIABILITY", category: "OTHER", normalBalance: "CREDIT", parentCode: "2000" },
  { code: "2301", name: "Employee Deductions Payable", type: "LIABILITY", category: "OTHER", normalBalance: "CREDIT", parentCode: "2300" },
  { code: "2302", name: "Accrued Expenses", type: "LIABILITY", category: "OTHER", normalBalance: "CREDIT", parentCode: "2000" },
  { code: "2303", name: "Customer Deposits/Prepayments", type: "LIABILITY", category: "OTHER", normalBalance: "CREDIT", parentCode: "2000" },
  { code: "2400", name: "Bank Loans and Overdrafts", type: "LIABILITY", category: "LOAN", normalBalance: "CREDIT", parentCode: "2000" },

  // ===== EQUITY (3000) =====
  { code: "3000", name: "Equity", type: "EQUITY", category: "GROUP", normalBalance: "CREDIT" },
  { code: "3100", name: "Owner's Capital", type: "EQUITY", category: "EQUITY", normalBalance: "CREDIT", parentCode: "3000" },
  { code: "3200", name: "Retained Earnings", type: "EQUITY", category: "EQUITY", normalBalance: "CREDIT", parentCode: "3000" },
  { code: "3300", name: "Current Year Earnings", type: "EQUITY", category: "EQUITY", normalBalance: "CREDIT", parentCode: "3000" },

  // ===== REVENUE (4000) =====
  { code: "4000", name: "Revenue", type: "REVENUE", category: "GROUP", normalBalance: "CREDIT" },
  { code: "4100", name: "Retail Sales", type: "REVENUE", category: "REVENUE", normalBalance: "CREDIT", parentCode: "4000" },
  { code: "4200", name: "Wholesale Sales", type: "REVENUE", category: "REVENUE", normalBalance: "CREDIT", parentCode: "4000" },
  { code: "4300", name: "Other Revenue", type: "REVENUE", category: "REVENUE", normalBalance: "CREDIT", parentCode: "4000" },
  { code: "4310", name: "Sales Returns", type: "CONTRA_REVENUE", category: "REVENUE", normalBalance: "DEBIT", parentCode: "4000" },
  { code: "4320", name: "Sales Discounts", type: "CONTRA_REVENUE", category: "REVENUE", normalBalance: "DEBIT", parentCode: "4000" },

  // ===== COST OF SALES (5000) =====
  { code: "5000", name: "Cost of Sales", type: "EXPENSE", category: "GROUP", normalBalance: "DEBIT" },
  { code: "5100", name: "Cost of Goods Sold", type: "EXPENSE", category: "COST_OF_SALES", normalBalance: "DEBIT", parentCode: "5000" },
  { code: "5200", name: "Stock Write-offs and Adjustments", type: "EXPENSE", category: "COST_OF_SALES", normalBalance: "DEBIT", parentCode: "5000" },
  { code: "5300", name: "Purchase Returns", type: "EXPENSE", category: "COST_OF_SALES", normalBalance: "CREDIT", parentCode: "5000" },

  // ===== OPERATING EXPENSES (6000) =====
  { code: "6000", name: "Operating Expenses", type: "EXPENSE", category: "GROUP", normalBalance: "DEBIT" },
  { code: "6100", name: "Salaries and Wages", type: "EXPENSE", category: "OPERATING_EXPENSE", normalBalance: "DEBIT", parentCode: "6000" },
  { code: "6110", name: "NSSA Contributions", type: "EXPENSE", category: "OPERATING_EXPENSE", normalBalance: "DEBIT", parentCode: "6000" },
  { code: "6120", name: "Pension Contributions", type: "EXPENSE", category: "OPERATING_EXPENSE", normalBalance: "DEBIT", parentCode: "6000" },
  { code: "6200", name: "Rent and Rates", type: "EXPENSE", category: "OPERATING_EXPENSE", normalBalance: "DEBIT", parentCode: "6000" },
  { code: "6300", name: "Utilities", type: "EXPENSE", category: "OPERATING_EXPENSE", normalBalance: "DEBIT", parentCode: "6000" },
  { code: "6400", name: "Transport and Delivery", type: "EXPENSE", category: "OPERATING_EXPENSE", normalBalance: "DEBIT", parentCode: "6000" },
  { code: "6500", name: "Repairs and Maintenance", type: "EXPENSE", category: "OPERATING_EXPENSE", normalBalance: "DEBIT", parentCode: "6000" },
  { code: "6600", name: "Marketing and Advertising", type: "EXPENSE", category: "OPERATING_EXPENSE", normalBalance: "DEBIT", parentCode: "6000" },
  { code: "6700", name: "Bank Charges", type: "EXPENSE", category: "OPERATING_EXPENSE", normalBalance: "DEBIT", parentCode: "6000" },
  { code: "6800", name: "Other Expenses", type: "EXPENSE", category: "OPERATING_EXPENSE", normalBalance: "DEBIT", parentCode: "6000" },
  { code: "6801", name: "Depreciation", type: "EXPENSE", category: "OPERATING_EXPENSE", normalBalance: "DEBIT", parentCode: "6000" },
  { code: "6802", name: "Insurance", type: "EXPENSE", category: "OPERATING_EXPENSE", normalBalance: "DEBIT", parentCode: "6000" },
  { code: "6803", name: "Telephone and Internet", type: "EXPENSE", category: "OPERATING_EXPENSE", normalBalance: "DEBIT", parentCode: "6000" },
  { code: "6804", name: "Security", type: "EXPENSE", category: "OPERATING_EXPENSE", normalBalance: "DEBIT", parentCode: "6000" },
  { code: "6805", name: "Stationery and Consumables", type: "EXPENSE", category: "OPERATING_EXPENSE", normalBalance: "DEBIT", parentCode: "6000" },
  { code: "6806", name: "Legal and Professional Fees", type: "EXPENSE", category: "OPERATING_EXPENSE", normalBalance: "DEBIT", parentCode: "6000" },
];