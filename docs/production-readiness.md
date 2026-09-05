# BetterERP Production Readiness

## Current Status

BetterERP has a working Express/Prisma backend and React/Vite frontend, but it is **not yet production-ready**. The system currently contains real database-backed workflows for authentication, RBAC, branches, products, inventory, POS sales, customers, procurement foundations, accounting reports, expenses, HR, payroll, approvals, reports, users, settings, assets, and notifications.

No fabricated operational transactions are created by the seed. The seed creates system configuration, roles, permissions, chart-of-accounts defaults, and the bootstrap administrator.

## Verified Commands

From `backend/`:

```powershell
npm run lint
npm test
npx prisma validate
npx prisma migrate status
```

From `frontend/`:

```powershell
npm run typecheck
npm run build
```

The current automated test suite contains focused unit tests for Decimal money arithmetic and branch-context helpers. Full integration coverage is still required.

## Environment Variables

Required:

- `DATABASE_URL`
- `JWT_SECRET`

Common configuration:

- `PORT` (default `4000`)
- `NODE_ENV`
- `JWT_EXPIRES_IN`
- `REFRESH_TOKEN_EXPIRES`
- `BCRYPT_ROUNDS`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX`
- `FILE_UPLOAD_DIR`
- `MAX_FILE_SIZE_MB`
- `CORS_ORIGIN` (comma-separated allowed origins)

Never use a development JWT secret in production. Store secrets outside source control.

## Database Deployment

```powershell
cd backend
npm run prisma:generate
npm run prisma:deploy
npm run db:seed
```

The seed is intended to be idempotent and must not be used as a source of business transactions.

## Implemented Security Controls

- Password hashing with bcrypt
- JWT authentication
- Database-backed session tracking and logout revocation
- Failed-login counters and temporary account lockout
- Backend permission enforcement
- Branch-aware authorization on core list and selected detail routes
- Helmet, rate limiting, input validation, and restricted CORS
- Audit records for important actions

## Known Release Blockers

- Full integration tests are not yet present for authentication, branch isolation, POS rollback, stock concurrency, procurement, accounting, tax, AR/AP, payroll, reports, and file security.
- Goods receipt and supplier invoice creation screens are now connected to the backend posting workflows. Supplier invoice matching and payment allocation still need broader integration coverage.
- Opening inventory/opening-balance import coverage, document generation, and several master-data screens require completion or verification. Product, supplier, customer, and employee CSV imports with preview/results, quotations with conversion to sales orders, sales-order approval/cancellation/fulfillment, customer receipt collection with invoice allocation, sales returns, purchase returns, interactive bank reconciliation, and validated bank statement CSV import are now connected to real workflows.
- PO-backed GRN/invoice accounting now uses a GRNI clearing account, but price variance, tax matching, and full three-way matching still need implementation.
- Payroll statutory calculations and posting require a formal Zimbabwe payroll rules review and integration tests.
- USD-base multi-currency POS payments are supported for configured currencies such as ZiG: administrators maintain effective rates, the server resolves the current rate, POS displays converted tender values, and each payment stores the original currency amount and rate. Split payments across multiple methods/currencies post each USD-base amount to the appropriate accounting account; automated end-to-end currency scenarios still require broader integration tests.
- Production deployment, backup/restore, queue/scheduler operation, email delivery, and private file storage need operational configuration and runbooks.

Do not declare the platform production-ready until these blockers have been tested and signed off against the business acceptance criteria.
