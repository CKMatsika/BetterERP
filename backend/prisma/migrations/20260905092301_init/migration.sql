-- CreateEnum
CREATE TYPE "EntityStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('STOCK', 'SERVICE', 'NON_STOCK', 'ASSET');

-- CreateEnum
CREATE TYPE "CostingMethod" AS ENUM ('WEIGHTED_AVERAGE', 'FIFO', 'STANDARD');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE_RECEIPT', 'SALES', 'SALES_RETURN', 'PURCHASE_RETURN', 'BRANCH_TRANSFER_OUT', 'BRANCH_TRANSFER_IN', 'BRANCH_TRANSFER_RECEIVE', 'STOCK_ADJUSTMENT', 'STOCK_COUNT', 'DAMAGE', 'WRITE_OFF', 'OPENING_STOCK', 'INTERNAL_CONSUMPTION', 'TRANSFER_IN_TRANSIT');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIAL_RECEIVED', 'RECEIVED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SaleType" AS ENUM ('POS', 'INVOICE', 'WHOLESALE', 'RETAIL', 'QUOTATION');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('DRAFT', 'HELD', 'COMPLETED', 'RETURNED', 'CANCELLED', 'VOID', 'PARTIAL_RETURN');

-- CreateEnum
CREATE TYPE "POSShiftEventType" AS ENUM ('OPEN', 'FLOAT', 'CASH_DROP', 'CASH_UP', 'DECLARATION', 'EXPENSE', 'REFUND', 'CLOSE');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('REQUESTED', 'PENDING_APPROVAL', 'APPROVED', 'DISPATCHED', 'IN_TRANSIT', 'PARTIAL_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'CONTRA_ASSET', 'CONTRA_REVENUE');

-- CreateEnum
CREATE TYPE "AccountNormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'TERMINATED', 'SUSPENDED', 'RESIGNED', 'RETIRED');

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('ANNUAL', 'SICK', 'MATERNITY', 'PATERNITY', 'UNPAID', 'COMPASSIONATE', 'STUDY', 'OTHER');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'TAKEN');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'POST', 'CANCEL', 'REVERSE', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'PRICE_CHANGE', 'STOCK_ADJUSTMENT', 'ACCOUNTING_ADJUSTMENT', 'EXPORT', 'PRINT', 'VIEW');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "registrationNumber" TEXT,
    "vatNumber" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Zimbabwe',
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "baseCurrency" TEXT NOT NULL DEFAULT 'USD',
    "fiscalYearStart" TIMESTAMP(3) NOT NULL,
    "isHq" BOOLEAN NOT NULL DEFAULT true,
    "logoUrl" TEXT,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyAddress" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "province" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Zimbabwe',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'BRANCH',
    "address" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "managerUserId" TEXT,
    "managerName" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "currency" TEXT DEFAULT 'USD',
    "defaultWarehouseId" TEXT,
    "taxConfiguration" JSONB,
    "accountingConfiguration" JSONB,
    "posConfiguration" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseLocation" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "managerId" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostCentre" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "departmentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostCentre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfitCentre" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "departmentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfitCentre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "canViewAllBranches" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "branchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "LoginHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "branchId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "loginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logoutAt" TIMESTAMP(3),

    CONSTRAINT "LoginHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "parentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitOfMeasure" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isBase" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnitOfMeasure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT,
    "subcategoryId" TEXT,
    "brandId" TEXT,
    "unitOfMeasureId" TEXT,
    "purchaseUnit" TEXT,
    "stockUnit" TEXT,
    "salesUnit" TEXT,
    "packSize" DECIMAL(12,2),
    "alternateUnits" JSONB,
    "type" "ProductType" NOT NULL DEFAULT 'STOCK',
    "costingMethod" "CostingMethod" NOT NULL DEFAULT 'WEIGHTED_AVERAGE',
    "costPrice" DECIMAL(18,4) DEFAULT 0,
    "averageCost" DECIMAL(18,4) DEFAULT 0,
    "lastPurchasePrice" DECIMAL(18,4),
    "sellingPrice" DECIMAL(18,4),
    "wholesalePrice" DECIMAL(18,4),
    "retailPrice" DECIMAL(18,4),
    "specialPrice" DECIMAL(18,4),
    "taxCategoryId" TEXT,
    "taxRateId" TEXT,
    "reorderLevel" DECIMAL(18,4) DEFAULT 0,
    "reorderQuantity" DECIMAL(18,4) DEFAULT 0,
    "minimumStock" DECIMAL(18,4) DEFAULT 0,
    "maximumStock" DECIMAL(18,4),
    "preferredSupplierId" TEXT,
    "imageUrl" TEXT,
    "imagePath" TEXT,
    "serialRequired" BOOLEAN NOT NULL DEFAULT false,
    "batchRequired" BOOLEAN NOT NULL DEFAULT false,
    "expiryRequired" BOOLEAN NOT NULL DEFAULT false,
    "weight" DECIMAL(12,4),
    "length" DECIMAL(12,4),
    "width" DECIMAL(12,4),
    "height" DECIMAL(12,4),
    "allowNegative" BOOLEAN NOT NULL DEFAULT false,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAlias" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSupplier" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierCode" TEXT,
    "costPrice" DECIMAL(18,4),
    "leadTimeDays" INTEGER,
    "isPreferred" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductBranch" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "sellingPrice" DECIMAL(18,4),
    "wholesalePrice" DECIMAL(18,4),
    "retailPrice" DECIMAL(18,4),
    "specialPrice" DECIMAL(18,4),
    "reorderLevel" DECIMAL(18,4),
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductBranch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPriceHistory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "branchId" TEXT,
    "field" TEXT NOT NULL,
    "oldValue" DECIMAL(18,4),
    "newValue" DECIMAL(18,4),
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "reference" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "beforeQty" DECIMAL(18,4) NOT NULL,
    "afterQty" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,4),
    "totalCost" DECIMAL(18,4),
    "sourceRef" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "userId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBalance" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "locationId" TEXT,
    "onHand" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "available" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "damaged" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "inTransit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "ordered" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "averageCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "reference" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "postedAt" TIMESTAMP(3),
    "postedById" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustmentLine" (
    "id" TEXT NOT NULL,
    "adjustmentId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT,
    "quantityChange" DECIMAL(18,4) NOT NULL,
    "newOnHand" DECIMAL(18,4),
    "reason" TEXT,
    "unitCost" DECIMAL(18,4),

    CONSTRAINT "StockAdjustmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "countedById" TEXT,
    "countDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "varianceAccounts" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT,
    "systemQty" DECIMAL(18,4) NOT NULL,
    "countedQty" DECIMAL(18,4) NOT NULL,
    "variance" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,4),

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "taxNumber" TEXT,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "province" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Zimbabwe',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "creditLimit" DECIMAL(18,4) DEFAULT 0,
    "paymentTerms" TEXT,
    "bankAccount" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierContact" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "customerType" TEXT NOT NULL DEFAULT 'RETAIL',
    "groupId" TEXT,
    "taxNumber" TEXT,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "province" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Zimbabwe',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "creditLimit" DECIMAL(18,4) DEFAULT 0,
    "creditApproved" BOOLEAN NOT NULL DEFAULT false,
    "creditApprovedById" TEXT,
    "paymentTerms" TEXT,
    "priceTier" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerGroup" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discount" DECIMAL(5,2) DEFAULT 0,
    "priceTier" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "requestedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "receivedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "backorderQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "taxRate" DECIMAL(5,2) DEFAULT 0,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "purchaseOrderId" TEXT,
    "supplierId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "receiptDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "receivedById" TEXT,
    "totalQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" TEXT NOT NULL,
    "goodsReceiptId" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT,
    "productId" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "locationId" TEXT,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "reference" TEXT NOT NULL,
    "docReference" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT,
    "productId" TEXT,
    "description" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "SupplierInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReturn" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "returnDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReturnLine" (
    "id" TEXT NOT NULL,
    "purchaseReturnId" TEXT NOT NULL,
    "productId" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "reference" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DECIMAL(18,4) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "bankAccountId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "notes" TEXT,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "customerId" TEXT,
    "reference" TEXT NOT NULL,
    "validUntil" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationLine" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "productId" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "QuotationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "customerId" TEXT,
    "reference" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderLine" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "productId" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "SalesOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "customerId" TEXT,
    "reference" TEXT NOT NULL,
    "type" "SaleType" NOT NULL DEFAULT 'POS',
    "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "saleDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cashierId" TEXT NOT NULL,
    "shiftId" TEXT,
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "changeDue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "paymentMethod" TEXT,
    "isCredit" BOOLEAN NOT NULL DEFAULT false,
    "creditDueDate" TIMESTAMP(3),
    "discountApprovedById" TEXT,
    "discountApprovedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "heldId" TEXT,
    "notes" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleLine" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "costPrice" DECIMAL(18,4),
    "discount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,2) DEFAULT 0,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "SaleLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalePayment" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "reference" TEXT,
    "bankAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "SalePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleReturn" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "saleId" TEXT,
    "customerId" TEXT,
    "reference" TEXT NOT NULL,
    "returnDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "refundMethod" TEXT,
    "refundAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleReturnLine" (
    "id" TEXT NOT NULL,
    "saleReturnId" TEXT NOT NULL,
    "productId" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "SaleReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerReceipt" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "receiptDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DECIMAL(18,4) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "bankAccountId" TEXT,
    "invoiceId" TEXT,
    "notes" TEXT,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POSShift" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "cashierId" TEXT NOT NULL,
    "terminal" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openingFloat" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "expectedCash" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "countedCash" DECIMAL(18,4),
    "variance" DECIMAL(18,4),
    "varianceNotes" TEXT,
    "varianceApproved" BOOLEAN NOT NULL DEFAULT false,
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "POSShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POSShiftEvent" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "type" "POSShiftEventType" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "method" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "POSShiftEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "sourceBranchId" TEXT NOT NULL,
    "sourceWarehouseId" TEXT,
    "destinationBranchId" TEXT NOT NULL,
    "destinationWarehouseId" TEXT,
    "status" "TransferStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT,
    "approvedById" TEXT,
    "dispatchedById" TEXT,
    "receivedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "expectedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferLine" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "productId" TEXT,
    "requestedQty" DECIMAL(18,4) NOT NULL,
    "dispatchedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "receivedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "damagedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(18,4),

    CONSTRAINT "StockTransferLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "category" TEXT,
    "normalBalance" "AccountNormalBalance" NOT NULL,
    "currency" TEXT DEFAULT 'USD',
    "parentId" TEXT,
    "isControl" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "openingBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cashAccountForBranchId" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "reference" TEXT NOT NULL,
    "description" TEXT,
    "entryType" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "entryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "postedAt" TIMESTAMP(3),
    "reversed" BOOLEAN NOT NULL DEFAULT false,
    "reversedById" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversalOfId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "branchId" TEXT,
    "departmentId" TEXT,
    "costCentreId" TEXT,
    "profitCentreId" TEXT,
    "debit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "accountId" TEXT,
    "accountName" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "branchCode" TEXT,
    "swiftCode" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "openingBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "withdrawal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "deposit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "balance" DECIMAL(18,4) NOT NULL,
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "reconciliationId" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankReconciliation" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "statementDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statementBalance" DECIMAL(18,4) NOT NULL,
    "bookBalance" DECIMAL(18,4) NOT NULL,
    "difference" DECIMAL(18,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "reconciledById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialPeriod" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'VAT',
    "isCompound" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Currency" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "isBase" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "currencyId" TEXT NOT NULL,
    "rateToBase" DECIMAL(18,6) NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "categoryId" TEXT,
    "reference" TEXT NOT NULL,
    "expenseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "supplierId" TEXT,
    "paymentMethod" TEXT,
    "bankAccountId" TEXT,
    "paidById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "receiptPath" TEXT,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "postedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountId" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PettyCash" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "balance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "topUpAmount" DECIMAL(18,4),
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PettyCash_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "employeeNumber" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "middleName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" TEXT,
    "nationalId" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "departmentId" TEXT,
    "positionId" TEXT,
    "managerId" TEXT,
    "employmentType" TEXT NOT NULL DEFAULT 'FULL_TIME',
    "employmentStatus" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "hireDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "terminationDate" TIMESTAMP(3),
    "salaryType" TEXT NOT NULL DEFAULT 'MONTHLY',
    "basicSalary" DECIMAL(18,4) DEFAULT 0,
    "hourlyRate" DECIMAL(18,4) DEFAULT 0,
    "bankName" TEXT,
    "bankAccountNumber" TEXT,
    "bankBranch" TEXT,
    "nssaNumber" TEXT,
    "taxNumber" TEXT,
    "isSalaried" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "departmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeAllowance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "percentage" DECIMAL(5,2),
    "isTaxable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeAllowance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDeduction" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "percentage" DECIMAL(5,2),
    "isStatutory" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeLoan" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "monthlyDeduction" DECIMAL(18,4) NOT NULL,
    "outstandingBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeLoan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "employeeId" TEXT NOT NULL,
    "leaveType" "LeaveType" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "days" INTEGER NOT NULL,
    "reason" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "employeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "clockIn" TIMESTAMP(3),
    "clockOut" TIMESTAMP(3),
    "hoursWorked" DECIMAL(6,2),
    "status" TEXT NOT NULL DEFAULT 'PRESENT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDocument" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT,

    CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payroll" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "periodName" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "payDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "totalGross" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalNet" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalTax" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "postedAt" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payroll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollLine" (
    "id" TEXT NOT NULL,
    "payrollId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "basicSalary" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "allowances" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "bonuses" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "overtime" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grossPay" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "statutoryDeductions" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "otherDeductions" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "loanDeductions" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "payeAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "nssaAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "pensionAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,

    CONSTRAINT "PayrollLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollSetting" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "type" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetCategory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "depreciationRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "depreciationMethod" TEXT NOT NULL DEFAULT 'STRAIGHT_LINE',
    "expenseAccountId" TEXT,
    "assetAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "categoryId" TEXT,
    "assetNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "serialNumber" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "purchaseCost" DECIMAL(18,4) NOT NULL,
    "salvageValue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "usefulLifeYears" INTEGER,
    "depreciationRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "accumulatedDepreciation" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "bookValue" DECIMAL(18,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "location" TEXT,
    "assignedTo" TEXT,
    "assignedEmployeeId" TEXT,
    "supplierId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetDepreciation" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "bookedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "journalId" TEXT,

    CONSTRAINT "AssetDepreciation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "userId" TEXT,
    "role" TEXT,
    "action" "AuditAction" NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "branchId" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'UNREAD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNotification" (
    "userId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("userId","notificationId")
);

-- CreateTable
CREATE TABLE "DocumentSequence" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "docType" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "separator" TEXT NOT NULL DEFAULT '-',
    "year" TEXT,
    "nextSeq" INTEGER NOT NULL DEFAULT 1,
    "padding" INTEGER NOT NULL DEFAULT 6,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "dataType" TEXT NOT NULL DEFAULT 'STRING',
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalWorkflow" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalLevel" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "roleId" TEXT,
    "minAmount" DECIMAL(18,4),
    "maxAmount" DECIMAL(18,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityRef" TEXT,
    "requestedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "comments" TEXT,
    "currentLevel" INTEGER NOT NULL DEFAULT 1,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalAction" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "approverId" TEXT,
    "action" TEXT NOT NULL,
    "comments" TEXT,
    "actionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyAddress_companyId_idx" ON "CompanyAddress"("companyId");

-- CreateIndex
CREATE INDEX "Branch_companyId_idx" ON "Branch"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_companyId_code_key" ON "Branch"("companyId", "code");

-- CreateIndex
CREATE INDEX "Warehouse_branchId_idx" ON "Warehouse"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_branchId_code_key" ON "Warehouse"("branchId", "code");

-- CreateIndex
CREATE INDEX "WarehouseLocation_warehouseId_idx" ON "WarehouseLocation"("warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseLocation_warehouseId_code_key" ON "WarehouseLocation"("warehouseId", "code");

-- CreateIndex
CREATE INDEX "Department_companyId_idx" ON "Department"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_companyId_code_key" ON "Department"("companyId", "code");

-- CreateIndex
CREATE INDEX "CostCentre_companyId_idx" ON "CostCentre"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CostCentre_companyId_code_key" ON "CostCentre"("companyId", "code");

-- CreateIndex
CREATE INDEX "ProfitCentre_companyId_idx" ON "ProfitCentre"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfitCentre_companyId_code_key" ON "ProfitCentre"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_companyId_idx" ON "User"("companyId");

-- CreateIndex
CREATE INDEX "User_branchId_idx" ON "User"("branchId");

-- CreateIndex
CREATE INDEX "Role_companyId_idx" ON "Role"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_companyId_name_key" ON "Role"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE INDEX "UserRole_branchId_idx" ON "UserRole"("branchId");

-- CreateIndex
CREATE INDEX "LoginHistory_userId_idx" ON "LoginHistory"("userId");

-- CreateIndex
CREATE INDEX "LoginHistory_loginAt_idx" ON "LoginHistory"("loginAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "Category_companyId_idx" ON "Category"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_companyId_code_key" ON "Category"("companyId", "code");

-- CreateIndex
CREATE INDEX "Brand_companyId_idx" ON "Brand"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_companyId_name_key" ON "Brand"("companyId", "name");

-- CreateIndex
CREATE INDEX "UnitOfMeasure_companyId_idx" ON "UnitOfMeasure"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "UnitOfMeasure_companyId_code_key" ON "UnitOfMeasure"("companyId", "code");

-- CreateIndex
CREATE INDEX "Product_companyId_name_idx" ON "Product"("companyId", "name");

-- CreateIndex
CREATE INDEX "Product_companyId_categoryId_idx" ON "Product"("companyId", "categoryId");

-- CreateIndex
CREATE INDEX "Product_companyId_brandId_idx" ON "Product"("companyId", "brandId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_companyId_sku_key" ON "Product"("companyId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "Product_companyId_barcode_key" ON "Product"("companyId", "barcode");

-- CreateIndex
CREATE INDEX "ProductAlias_productId_idx" ON "ProductAlias"("productId");

-- CreateIndex
CREATE INDEX "ProductAlias_alias_idx" ON "ProductAlias"("alias");

-- CreateIndex
CREATE INDEX "ProductSupplier_supplierId_idx" ON "ProductSupplier"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSupplier_productId_supplierId_key" ON "ProductSupplier"("productId", "supplierId");

-- CreateIndex
CREATE INDEX "ProductBranch_branchId_idx" ON "ProductBranch"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductBranch_productId_branchId_key" ON "ProductBranch"("productId", "branchId");

-- CreateIndex
CREATE INDEX "ProductPriceHistory_productId_idx" ON "ProductPriceHistory"("productId");

-- CreateIndex
CREATE INDEX "ProductPriceHistory_changedAt_idx" ON "ProductPriceHistory"("changedAt");

-- CreateIndex
CREATE INDEX "StockMovement_companyId_productId_idx" ON "StockMovement"("companyId", "productId");

-- CreateIndex
CREATE INDEX "StockMovement_branchId_idx" ON "StockMovement"("branchId");

-- CreateIndex
CREATE INDEX "StockMovement_type_idx" ON "StockMovement"("type");

-- CreateIndex
CREATE INDEX "StockMovement_sourceId_idx" ON "StockMovement"("sourceId");

-- CreateIndex
CREATE INDEX "StockMovement_createdAt_idx" ON "StockMovement"("createdAt");

-- CreateIndex
CREATE INDEX "StockBalance_warehouseId_idx" ON "StockBalance"("warehouseId");

-- CreateIndex
CREATE INDEX "StockBalance_productId_idx" ON "StockBalance"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "StockBalance_productId_warehouseId_locationId_key" ON "StockBalance"("productId", "warehouseId", "locationId");

-- CreateIndex
CREATE INDEX "StockAdjustment_companyId_branchId_idx" ON "StockAdjustment"("companyId", "branchId");

-- CreateIndex
CREATE INDEX "StockAdjustmentLine_adjustmentId_idx" ON "StockAdjustmentLine"("adjustmentId");

-- CreateIndex
CREATE INDEX "StockCount_companyId_branchId_idx" ON "StockCount"("companyId", "branchId");

-- CreateIndex
CREATE INDEX "StockCountLine_countId_idx" ON "StockCountLine"("countId");

-- CreateIndex
CREATE INDEX "Supplier_companyId_name_idx" ON "Supplier"("companyId", "name");

-- CreateIndex
CREATE INDEX "Supplier_branchId_idx" ON "Supplier"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_companyId_code_key" ON "Supplier"("companyId", "code");

-- CreateIndex
CREATE INDEX "SupplierContact_supplierId_idx" ON "SupplierContact"("supplierId");

-- CreateIndex
CREATE INDEX "Customer_companyId_name_idx" ON "Customer"("companyId", "name");

-- CreateIndex
CREATE INDEX "Customer_branchId_idx" ON "Customer"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_companyId_code_key" ON "Customer"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerGroup_companyId_name_key" ON "CustomerGroup"("companyId", "name");

-- CreateIndex
CREATE INDEX "PurchaseRequest_companyId_branchId_idx" ON "PurchaseRequest"("companyId", "branchId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_companyId_branchId_idx" ON "PurchaseOrder"("companyId", "branchId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_purchaseOrderId_idx" ON "PurchaseOrderLine"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "GoodsReceipt_companyId_branchId_idx" ON "GoodsReceipt"("companyId", "branchId");

-- CreateIndex
CREATE INDEX "GoodsReceipt_purchaseOrderId_idx" ON "GoodsReceipt"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_goodsReceiptId_idx" ON "GoodsReceiptLine"("goodsReceiptId");

-- CreateIndex
CREATE INDEX "SupplierInvoice_companyId_branchId_idx" ON "SupplierInvoice"("companyId", "branchId");

-- CreateIndex
CREATE INDEX "SupplierInvoice_supplierId_idx" ON "SupplierInvoice"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierInvoice_status_idx" ON "SupplierInvoice"("status");

-- CreateIndex
CREATE INDEX "SupplierInvoiceLine_invoiceId_idx" ON "SupplierInvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "PurchaseReturn_companyId_branchId_idx" ON "PurchaseReturn"("companyId", "branchId");

-- CreateIndex
CREATE INDEX "PurchaseReturnLine_purchaseReturnId_idx" ON "PurchaseReturnLine"("purchaseReturnId");

-- CreateIndex
CREATE INDEX "SupplierPayment_companyId_branchId_idx" ON "SupplierPayment"("companyId", "branchId");

-- CreateIndex
CREATE INDEX "SupplierPayment_supplierId_idx" ON "SupplierPayment"("supplierId");

-- CreateIndex
CREATE INDEX "Quotation_companyId_branchId_idx" ON "Quotation"("companyId", "branchId");

-- CreateIndex
CREATE INDEX "QuotationLine_quotationId_idx" ON "QuotationLine"("quotationId");

-- CreateIndex
CREATE INDEX "SalesOrder_companyId_branchId_idx" ON "SalesOrder"("companyId", "branchId");

-- CreateIndex
CREATE INDEX "SalesOrderLine_salesOrderId_idx" ON "SalesOrderLine"("salesOrderId");

-- CreateIndex
CREATE INDEX "Sale_companyId_branchId_idx" ON "Sale"("companyId", "branchId");

-- CreateIndex
CREATE INDEX "Sale_customerId_idx" ON "Sale"("customerId");

-- CreateIndex
CREATE INDEX "Sale_saleDate_idx" ON "Sale"("saleDate");

-- CreateIndex
CREATE INDEX "Sale_status_idx" ON "Sale"("status");

-- CreateIndex
CREATE INDEX "SaleLine_saleId_idx" ON "SaleLine"("saleId");

-- CreateIndex
CREATE INDEX "SalePayment_saleId_idx" ON "SalePayment"("saleId");

-- CreateIndex
CREATE INDEX "SaleReturn_companyId_branchId_idx" ON "SaleReturn"("companyId", "branchId");

-- CreateIndex
CREATE INDEX "SaleReturn_saleId_idx" ON "SaleReturn"("saleId");

-- CreateIndex
CREATE INDEX "SaleReturnLine_saleReturnId_idx" ON "SaleReturnLine"("saleReturnId");

-- CreateIndex
CREATE INDEX "CustomerReceipt_companyId_branchId_idx" ON "CustomerReceipt"("companyId", "branchId");

-- CreateIndex
CREATE INDEX "CustomerReceipt_customerId_idx" ON "CustomerReceipt"("customerId");

-- CreateIndex
CREATE INDEX "POSShift_companyId_branchId_idx" ON "POSShift"("companyId", "branchId");

-- CreateIndex
CREATE INDEX "POSShift_cashierId_idx" ON "POSShift"("cashierId");

-- CreateIndex
CREATE INDEX "POSShift_status_idx" ON "POSShift"("status");

-- CreateIndex
CREATE INDEX "POSShiftEvent_shiftId_idx" ON "POSShiftEvent"("shiftId");

-- CreateIndex
CREATE INDEX "StockTransfer_companyId_sourceBranchId_idx" ON "StockTransfer"("companyId", "sourceBranchId");

-- CreateIndex
CREATE INDEX "StockTransfer_destinationBranchId_idx" ON "StockTransfer"("destinationBranchId");

-- CreateIndex
CREATE INDEX "StockTransfer_status_idx" ON "StockTransfer"("status");

-- CreateIndex
CREATE INDEX "StockTransferLine_transferId_idx" ON "StockTransferLine"("transferId");

-- CreateIndex
CREATE INDEX "Account_companyId_idx" ON "Account"("companyId");

-- CreateIndex
CREATE INDEX "Account_branchId_idx" ON "Account"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_companyId_branchId_code_key" ON "Account"("companyId", "branchId", "code");

-- CreateIndex
CREATE INDEX "JournalEntry_companyId_branchId_idx" ON "JournalEntry"("companyId", "branchId");

-- CreateIndex
CREATE INDEX "JournalEntry_sourceType_sourceId_idx" ON "JournalEntry"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "JournalEntry_entryDate_idx" ON "JournalEntry"("entryDate");

-- CreateIndex
CREATE INDEX "JournalEntry_entryType_idx" ON "JournalEntry"("entryType");

-- CreateIndex
CREATE INDEX "JournalLine_journalEntryId_idx" ON "JournalLine"("journalEntryId");

-- CreateIndex
CREATE INDEX "JournalLine_accountId_idx" ON "JournalLine"("accountId");

-- CreateIndex
CREATE INDEX "JournalLine_branchId_idx" ON "JournalLine"("branchId");

-- CreateIndex
CREATE INDEX "BankAccount_companyId_idx" ON "BankAccount"("companyId");

-- CreateIndex
CREATE INDEX "BankAccount_branchId_idx" ON "BankAccount"("branchId");

-- CreateIndex
CREATE INDEX "BankTransaction_bankAccountId_idx" ON "BankTransaction"("bankAccountId");

-- CreateIndex
CREATE INDEX "BankTransaction_reconciled_idx" ON "BankTransaction"("reconciled");

-- CreateIndex
CREATE INDEX "BankReconciliation_bankAccountId_idx" ON "BankReconciliation"("bankAccountId");

-- CreateIndex
CREATE INDEX "FinancialPeriod_companyId_idx" ON "FinancialPeriod"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialPeriod_companyId_name_key" ON "FinancialPeriod"("companyId", "name");

-- CreateIndex
CREATE INDEX "TaxRate_companyId_idx" ON "TaxRate"("companyId");

-- CreateIndex
CREATE INDEX "Currency_companyId_idx" ON "Currency"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Currency_companyId_code_key" ON "Currency"("companyId", "code");

-- CreateIndex
CREATE INDEX "ExchangeRate_currencyId_effectiveDate_idx" ON "ExchangeRate"("currencyId", "effectiveDate");

-- CreateIndex
CREATE INDEX "Expense_companyId_branchId_idx" ON "Expense"("companyId", "branchId");

-- CreateIndex
CREATE INDEX "Expense_expenseDate_idx" ON "Expense"("expenseDate");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_companyId_name_key" ON "ExpenseCategory"("companyId", "name");

-- CreateIndex
CREATE INDEX "PettyCash_companyId_branchId_idx" ON "PettyCash"("companyId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeNumber_key" ON "Employee"("employeeNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE INDEX "Employee_companyId_idx" ON "Employee"("companyId");

-- CreateIndex
CREATE INDEX "Employee_branchId_idx" ON "Employee"("branchId");

-- CreateIndex
CREATE INDEX "Employee_departmentId_idx" ON "Employee"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Position_companyId_name_key" ON "Position"("companyId", "name");

-- CreateIndex
CREATE INDEX "EmployeeAllowance_employeeId_idx" ON "EmployeeAllowance"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeDeduction_employeeId_idx" ON "EmployeeDeduction"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeLoan_employeeId_idx" ON "EmployeeLoan"("employeeId");

-- CreateIndex
CREATE INDEX "LeaveRequest_employeeId_idx" ON "LeaveRequest"("employeeId");

-- CreateIndex
CREATE INDEX "LeaveRequest_status_idx" ON "LeaveRequest"("status");

-- CreateIndex
CREATE INDEX "Attendance_employeeId_idx" ON "Attendance"("employeeId");

-- CreateIndex
CREATE INDEX "Attendance_date_idx" ON "Attendance"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_employeeId_date_key" ON "Attendance"("employeeId", "date");

-- CreateIndex
CREATE INDEX "EmployeeDocument_employeeId_idx" ON "EmployeeDocument"("employeeId");

-- CreateIndex
CREATE INDEX "Payroll_companyId_branchId_idx" ON "Payroll"("companyId", "branchId");

-- CreateIndex
CREATE INDEX "Payroll_status_idx" ON "Payroll"("status");

-- CreateIndex
CREATE INDEX "PayrollLine_payrollId_idx" ON "PayrollLine"("payrollId");

-- CreateIndex
CREATE INDEX "PayrollLine_employeeId_idx" ON "PayrollLine"("employeeId");

-- CreateIndex
CREATE INDEX "PayrollSetting_companyId_type_idx" ON "PayrollSetting"("companyId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "AssetCategory_companyId_name_key" ON "AssetCategory"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_assetNumber_key" ON "Asset"("assetNumber");

-- CreateIndex
CREATE INDEX "Asset_companyId_idx" ON "Asset"("companyId");

-- CreateIndex
CREATE INDEX "Asset_branchId_idx" ON "Asset"("branchId");

-- CreateIndex
CREATE INDEX "Asset_categoryId_idx" ON "Asset"("categoryId");

-- CreateIndex
CREATE INDEX "AssetDepreciation_assetId_idx" ON "AssetDepreciation"("assetId");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_idx" ON "AuditLog"("companyId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_companyId_idx" ON "Notification"("companyId");

-- CreateIndex
CREATE INDEX "Notification_entityType_entityId_idx" ON "Notification"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "UserNotification_userId_readAt_idx" ON "UserNotification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "DocumentSequence_companyId_docType_idx" ON "DocumentSequence"("companyId", "docType");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSequence_companyId_branchId_docType_year_key" ON "DocumentSequence"("companyId", "branchId", "docType", "year");

-- CreateIndex
CREATE INDEX "Attachment_entityType_entityId_idx" ON "Attachment"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Attachment_companyId_idx" ON "Attachment"("companyId");

-- CreateIndex
CREATE INDEX "AppSetting_companyId_group_idx" ON "AppSetting"("companyId", "group");

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_companyId_group_key_key" ON "AppSetting"("companyId", "group", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalWorkflow_companyId_entityType_key" ON "ApprovalWorkflow"("companyId", "entityType");

-- CreateIndex
CREATE INDEX "ApprovalLevel_workflowId_idx" ON "ApprovalLevel"("workflowId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_companyId_idx" ON "ApprovalRequest"("companyId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_entityType_entityId_idx" ON "ApprovalRequest"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_idx" ON "ApprovalRequest"("status");

-- CreateIndex
CREATE INDEX "ApprovalAction_approvalRequestId_idx" ON "ApprovalAction"("approvalRequestId");

-- AddForeignKey
ALTER TABLE "CompanyAddress" ADD CONSTRAINT "CompanyAddress_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseLocation" ADD CONSTRAINT "WarehouseLocation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCentre" ADD CONSTRAINT "CostCentre_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitCentre" ADD CONSTRAINT "ProfitCentre_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginHistory" ADD CONSTRAINT "LoginHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_unitOfMeasureId_fkey" FOREIGN KEY ("unitOfMeasureId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "TaxRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_preferredSupplierId_fkey" FOREIGN KEY ("preferredSupplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAlias" ADD CONSTRAINT "ProductAlias_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSupplier" ADD CONSTRAINT "ProductSupplier_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSupplier" ADD CONSTRAINT "ProductSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBranch" ADD CONSTRAINT "ProductBranch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBranch" ADD CONSTRAINT "ProductBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPriceHistory" ADD CONSTRAINT "ProductPriceHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustmentLine" ADD CONSTRAINT "StockAdjustmentLine_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "StockAdjustment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierContact" ADD CONSTRAINT "SupplierContact_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CustomerGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturnLine" ADD CONSTRAINT "PurchaseReturnLine_purchaseReturnId_fkey" FOREIGN KEY ("purchaseReturnId") REFERENCES "PurchaseReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "POSShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnLine" ADD CONSTRAINT "SaleReturnLine_saleReturnId_fkey" FOREIGN KEY ("saleReturnId") REFERENCES "SaleReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerReceipt" ADD CONSTRAINT "CustomerReceipt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSShift" ADD CONSTRAINT "POSShift_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSShiftEvent" ADD CONSTRAINT "POSShiftEvent_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "POSShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_cashAccountForBranchId_fkey" FOREIGN KEY ("cashAccountForBranchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliation" ADD CONSTRAINT "BankReconciliation_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Currency" ADD CONSTRAINT "Currency_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAllowance" ADD CONSTRAINT "EmployeeAllowance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDeduction" ADD CONSTRAINT "EmployeeDeduction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeLoan" ADD CONSTRAINT "EmployeeLoan_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "Payroll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AssetCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetDepreciation" ADD CONSTRAINT "AssetDepreciation_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalLevel" ADD CONSTRAINT "ApprovalLevel_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "ApprovalWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalLevel" ADD CONSTRAINT "ApprovalLevel_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalAction" ADD CONSTRAINT "ApprovalAction_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
