import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from 'pg';
import bcrypt from 'bcryptjs';

const connectionString = process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const admin = await prisma.user.findUnique({
    where: { username: "admin" }
  });
  
  if (!admin) {
    console.error("Admin user not found");
    return;
  }

  const products = [
    {
      companyId: admin.companyId,
      createdById: admin.id,
      sku: "B-CHEESE",
      name: "Cheeseburger",
      type: "STOCK",
      costPrice: 2.50,
      sellingPrice: 5.99,
      isPosFeatured: true,
      posColor: "#FFD166", // yellow-ish
    },
    {
      companyId: admin.companyId,
      createdById: admin.id,
      sku: "B-FRIES-L",
      name: "Large Fries",
      type: "STOCK",
      costPrice: 0.80,
      sellingPrice: 2.99,
      isPosFeatured: true,
      posColor: "#F4A261", // orange
    },
    {
      companyId: admin.companyId,
      createdById: admin.id,
      sku: "D-COKE",
      name: "Coca Cola (Can)",
      type: "STOCK",
      costPrice: 0.50,
      sellingPrice: 1.50,
      isPosFeatured: true,
      posColor: "#E76F51", // reddish
    },
    {
      companyId: admin.companyId,
      createdById: admin.id,
      sku: "D-COFFEE",
      name: "Latte Coffee",
      type: "STOCK",
      costPrice: 0.90,
      sellingPrice: 3.50,
      isPosFeatured: true,
      posColor: "#8D99AE", // grey/blue
    },
    {
      companyId: admin.companyId,
      createdById: admin.id,
      sku: "D-WATER",
      name: "Mineral Water",
      type: "STOCK",
      costPrice: 0.30,
      sellingPrice: 1.00,
      isPosFeatured: true,
      posColor: "#457B9D", // blue
    }
  ];

  for (const p of products) {
    const existing = await prisma.product.findUnique({
      where: { companyId_sku: { companyId: admin.companyId, sku: p.sku } }
    });
    if (!existing) {
      await prisma.product.create({
        data: p as any
      });
      console.log(`Created product: ${p.name}`);
    } else {
      console.log(`Product already exists: ${p.name}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
