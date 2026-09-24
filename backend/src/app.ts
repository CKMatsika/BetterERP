import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import path from "path";
import { env } from "./config";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { authenticate } from "./middleware/auth";
import { logger } from "./lib/logger";

import authRoutes from "./routes/auth.routes";
import companyRoutes from "./routes/company.routes";
import branchRoutes from "./routes/branch.routes";
import userRoutes from "./routes/user.routes";
import productRoutes from "./routes/product.routes";
import inventoryRoutes from "./routes/inventory.routes";
import procurementRoutes from "./routes/procurement.routes";
import salesRoutes from "./routes/sales.routes";
import customerRoutes from "./routes/customer.routes";
import transferRoutes from "./routes/transfer.routes";
import accountingRoutes from "./routes/accounting.routes";
import bankingRoutes from "./routes/banking.routes";
import expenseRoutes from "./routes/expense.routes";
import hrRoutes from "./routes/hr.routes";
import payrollRoutes from "./routes/payroll.routes";
import assetRoutes from "./routes/asset.routes";
import taxRoutes from "./routes/tax.routes";
import settingRoutes from "./routes/setting.routes";
import dashboardRoutes from "./routes/dashboard.routes";
import reportRoutes from "./routes/report.routes";
import notificationRoutes from "./routes/notification.routes";
import searchRoutes from "./routes/search.routes";
import fileRoutes from "./routes/file.routes";
import auditRoutes from "./routes/audit.routes";
import approvalRoutes from "./routes/approval.routes";
import miscRoutes from "./routes/misc.routes";
import productionRoutes from "./routes/production.routes";

export function createApp() {
  const app = express();

  // Security headers
  app.use(helmet());

  // CORS
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || env.corsOrigin.includes(origin)) return cb(null, true);
        return cb(new Error("Origin is not allowed by CORS"));
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan("combined", { stream: { write: (msg: string) => logger.info(msg.trim()) } }));

  // API rate limiting
  const apiLimiter = rateLimit({
    windowMs: env.rateLimitWindowMs,
    max: env.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "Too many requests, please try again later" } },
  });
  app.use("/api", apiLimiter);

  // Static uploads (protected via signed route in file.routes for private files)
  app.use("/uploads", express.static(path.resolve(process.cwd(), env.fileUploadDir)));

  // Health check
  app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "bettererp", time: new Date().toISOString() }));

  // === Public routes ===
  app.use("/api/auth", authRoutes);

  // === Protected routes ===
  app.use("/api/company", authenticate, companyRoutes);
  app.use("/api/branches", authenticate, branchRoutes);
  app.use("/api/users", authenticate, userRoutes);
  app.use("/api/products", authenticate, productRoutes);
  app.use("/api/inventory", authenticate, inventoryRoutes);
  app.use("/api/procurement", authenticate, procurementRoutes);
  app.use("/api/sales", authenticate, salesRoutes);
  app.use("/api/customers", authenticate, customerRoutes);
  app.use("/api/transfers", authenticate, transferRoutes);
  app.use("/api/accounting", authenticate, accountingRoutes);
  app.use("/api/banking", authenticate, bankingRoutes);
  app.use("/api/expenses", authenticate, expenseRoutes);
  app.use("/api/hr", authenticate, hrRoutes);
  app.use("/api/payroll", authenticate, payrollRoutes);
  app.use("/api/assets", authenticate, assetRoutes);
  app.use("/api/tax", authenticate, taxRoutes);
  app.use("/api/settings", authenticate, settingRoutes);
  app.use("/api/dashboard", authenticate, dashboardRoutes);
  app.use("/api/reports", authenticate, reportRoutes);
  app.use("/api/notifications", authenticate, notificationRoutes);
  app.use("/api/search", authenticate, searchRoutes);
  app.use("/api/files", authenticate, fileRoutes);
  app.use("/api/audit", authenticate, auditRoutes);
  app.use("/api/approvals", authenticate, approvalRoutes);
  app.use("/api/misc", authenticate, miscRoutes);
  app.use("/api/production", authenticate, productionRoutes);

  // 404
  app.use(notFoundHandler);

  // Error handling
  app.use(errorHandler);

  return app;
}