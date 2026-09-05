-- Employees may exist without a linked application login.
ALTER TABLE "Employee" ALTER COLUMN "userId" DROP NOT NULL;
