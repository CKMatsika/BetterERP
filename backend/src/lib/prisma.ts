import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config";

const adapter = new PrismaPg(env.databaseUrl);

export const prisma = new PrismaClient({ adapter });

export type Prisma = typeof prisma;
export { PrismaPg };