import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { PERMISSIONS, DEFAULT_ROLES } from "../src/seed/permissions";
import { DEFAULT_CHART_OF_ACCOUNTS, AccountSeedDef } from "../src/seed/chartOfAccounts";

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

async function seedPermissions() {
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { module: p.module, resource: p.resource, action: p.action, description: p.description },
      create: p,
    });
  }
  console.log(`Seeded ${PERMISSIONS.length} permissions`);
}

async function seedRoles(companyId: string) {
  const existing = await prisma.role.count({ where: { companyId } });

  for (const role of DEFAULT_ROLES) {
    const created = await prisma.role.upsert({
      where: { companyId_name: { companyId, name: role.name } },
      update: { description: role.description },
      create: {
        companyId,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        isDefault: role.isDefault,
      },
    });

    const permissionIds = (
      await prisma.permission.findMany({ where: { code: { in: role.permissions } }, select: { id: true } })
    ).map((p) => p.id);

    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: created.id } }),
      prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId: created.id, permissionId })),
      }),
    ]);
  }
  console.log(`Seeded ${DEFAULT_ROLES.length} default roles (company ${existing === 0 ? "new" : "existing"})`);
}

async function seedCompanyAndAdmin() {
  const companyCount = await prisma.company.count();

  if (companyCount === 0) {
    const company = await prisma.company.create({
      data: {
        name: "BetterERP Company",
        legalName: "BetterERP Company (Pvt) Ltd",
        registrationNumber: "",
        vatNumber: "",
        country: "Zimbabwe",
        currency: "USD",
        baseCurrency: "USD",
        fiscalYearStart: new Date(new Date().getFullYear(), 0, 1),
        settings: {
          timeZone: "Africa/Harare",
          fiscalYearEnd: "Dec 31",
        },
      },
    });

    // Currency seed system config
    await prisma.currency.createMany({
      data: [
        { companyId: company.id, code: "USD", name: "US Dollar", symbol: "$", isBase: true },
        { companyId: company.id, code: "ZIG", name: "Zimbabwe Gold", symbol: "ZiG" },
      ],
    });

    // Default tax configuration (configurable, not hard-coded in transactions)
    await prisma.taxRate.createMany({
      data: [
        { companyId: company.id, name: "Zero Rated", rate: 0, type: "ZERO_RATED", isActive: true },
        { companyId: company.id, name: "Standard VAT 15%", rate: 15, type: "VAT", isActive: true },
        { companyId: company.id, name: "VAT Exempt", rate: 0, type: "EXEMPT", isActive: true },
      ],
    });

    // Default payroll settings (configurable)
    await prisma.payrollSetting.createMany({
      data: [
        { companyId: company.id, name: "NSSA Employee Rate", value: 0.06, type: "NSSA_RATE" },
        { companyId: company.id, name: "PAYE Tax Free Threshold", value: 750.0, type: "PAYE_BRACKET" },
      ],
    });

    // HQ default branch
    const hqBranch = await prisma.branch.create({
      data: {
        companyId: company.id,
        code: "HQ",
        name: "Head Office",
        type: "HQ",
        status: "ACTIVE",
        currency: "USD",
      },
    });

    const hqWarehouse = await prisma.warehouse.create({
      data: { branchId: hqBranch.id, code: "MAIN", name: "HQ Main Warehouse", isDefault: true },
    });

    await prisma.branch.update({
      where: { id: hqBranch.id },
      data: { defaultWarehouseId: hqWarehouse.id },
    });

    // Default chart of accounts (per company; system config)
    const accountMap = new Map<string, string>();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await seedAccount(company.id, acc, accountMap);
    }

    // System settings
    const defaultSettings: Array<[string, string, string, string, string]> = [
      ["INVENTORY", "costing_method", "WEIGHTED_AVERAGE", "STRING", "true"],
      ["INVENTORY", "allow_negative_stock", "false", "BOOLEAN", "true"],
      ["POS", "default_payment_method", "CASH", "STRING", "true"],
      ["POS", "allow_split_payment", "true", "BOOLEAN", "true"],
      ["POS", "receipt_footer", "Thank you for shopping with us!", "STRING", "false"],
      ["ACCOUNTING", "auto_post_inventory", "true", "BOOLEAN", "false"],
      ["ACCOUNTING", "default_vat_mode", "INCLUSIVE", "STRING", "false"],
      ["SYSTEM", "numbering_year_format", "YYYY", "STRING", "false"],
      ["APPROVALS", "purchase_order_threshold_manager", "500", "NUMBER", "false"],
      ["APPROVALS", "purchase_order_threshold_finance", "5000", "NUMBER", "false"],
      ["NOTIFICATIONS", "email_enabled", "false", "BOOLEAN", "false"],
      ["NOTIFICATIONS", "sms_enabled", "false", "BOOLEAN", "false"],
    ];
    for (const [group, key, value, dataType, isPublic] of defaultSettings) {
      await prisma.appSetting.upsert({
        where: { companyId_group_key: { companyId: company.id, group, key } },
        update: { value, dataType, isPublic: isPublic === "true" },
        create: { companyId: company.id, group, key, value, dataType, isPublic: isPublic === "true" },
      });
    }

    // HQ Super Administrator user
    const username = process.env.ADMIN_USERNAME ?? process.env.ADMIN_EMAIL ?? "admin";
    const email = process.env.ADMIN_EMAIL ?? "admin@bettererp.local";
    const password = process.env.ADMIN_PASSWORD ?? "Admin123!";
    const passwordHash = await bcrypt.hash(password, 12);

    const adminUser = await prisma.user.create({
      data: {
        companyId: company.id,
        branchId: hqBranch.id,
        username,
        email,
        fullName: "System Administrator",
        passwordHash,
        isActive: true,
        mustChangePassword: true,
        canViewAllBranches: true,
      },
    });

    const adminRole = await prisma.role.findFirst({
      where: { companyId: company.id, name: "HQ Super Administrator" },
    });
    if (adminRole) {
      await prisma.userRole.create({ data: { userId: adminUser.id, roleId: adminRole.id, branchId: hqBranch.id } });
    }

    console.log(`Seeded system configuration for company: ${company.id}`);
    console.log(`Default administrator created: username=${username}, email=${email}`);
    if (!process.env.ADMIN_PASSWORD) {
      console.log("NOTE: Using default bootstrap password 'Admin123!'. Change it on first login.");
    }
  } else {
    console.log("Company already exists, skipping company/administrator seed.");
  }
}

// Ensures the system administrator is assigned the super-admin role (idempotent re-seeds)
async function ensureAdminRole(companyId: string) {
  const username = process.env.ADMIN_USERNAME ?? process.env.ADMIN_EMAIL ?? "admin";
  const adminUser = await prisma.user.findUnique({ where: { username } });
  if (!adminUser) return;
  const adminRole = await prisma.role.findFirst({
    where: { companyId, name: "HQ Super Administrator" },
  });
  if (!adminRole) return;
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: adminUser.id, roleId: adminRole.id } },
    update: {},
    create: { userId: adminUser.id, roleId: adminRole.id },
  });
  console.log(`Ensured system administrator role: username=${username}`);
}

async function seedAccount(companyId: string, seed: AccountSeedDef, accountMap: Map<string, string>) {
  const exists = await prisma.account.findFirst({
    where: { companyId, branchId: null, code: seed.code },
  });
  if (exists) {
    accountMap.set(seed.code, exists.id);
    return;
  }
  const parentId = seed.parentCode ? accountMap.get(seed.parentCode) : null;
  const account = await prisma.account.create({
    data: {
      companyId,
      code: seed.code,
      name: seed.name,
      type: seed.type,
      category: seed.category,
      normalBalance: seed.normalBalance,
      parentId,
    },
  });
  accountMap.set(seed.code, account.id);
}

async function main() {
  await seedPermissions();
  const companyCount = await prisma.company.count();
  if (companyCount === 0) {
    await seedCompanyAndAdmin();
  }
  const company = await prisma.company.findFirst();
  if (company) {
    await seedRoles(company.id);
    await ensureAdminRole(company.id);
  }
  console.log("Seed completed");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });