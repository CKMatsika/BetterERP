import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { Decimal } from "decimal.js";

const router = Router();
router.use(authenticate);

// List all recipes
router.get("/recipes", async (req, res) => {
  try {
    const recipes = await prisma.recipe.findMany({
      where: { companyId: req.user!.companyId },
      include: {
        product: true,
        ingredients: {
          include: {
            product: true
          }
        }
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(recipes);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch recipes" });
  }
});

// Create recipe
router.post("/recipes", async (req, res) => {
  try {
    const schema = z.object({
      productId: z.string(),
      name: z.string(),
      yield: z.number().min(0.01),
      ingredients: z.array(z.object({
        productId: z.string(),
        quantity: z.number().min(0.0001),
      })).min(1),
    });

    const data = schema.parse(req.body);

    const recipe = await prisma.recipe.create({
      data: {
        companyId: req.user!.companyId,
        productId: data.productId,
        name: data.name,
        yield: data.yield,
        ingredients: {
          create: data.ingredients.map(i => ({
            productId: i.productId,
            quantity: i.quantity
          }))
        }
      },
      include: {
        ingredients: true
      }
    });

    res.status(201).json(recipe);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Invalid recipe data" });
  }
});

// Get all production runs
router.get("/runs", async (req, res) => {
  try {
    const runs = await prisma.productionRun.findMany({
      where: { companyId: req.user!.companyId },
      include: {
        recipe: { include: { product: true } },
        createdBy: { select: { fullName: true } }
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(runs);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch production runs" });
  }
});

// Execute production run
router.post("/runs", async (req, res) => {
  try {
    const schema = z.object({
      branchId: z.string(),
      warehouseId: z.string(),
      recipeId: z.string(),
      outputQty: z.number().min(0.01),
    });

    const data = schema.parse(req.body);

    const recipe = await prisma.recipe.findUnique({
      where: { id: data.recipeId },
      include: { ingredients: true, product: true }
    });

    if (!recipe) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    // Multiply ingredients by (outputQty / recipe.yield)
    const multiplier = new Decimal(data.outputQty).dividedBy(recipe.yield);

    const result = await prisma.$transaction(async (tx) => {
      let totalCost = new Decimal(0);
      const lines = [];
      const stockMovements = [];
      const balanceUpdates = [];
      
      const reference = `PROD-${Date.now().toString().slice(-6)}`;

      // 1. Consume ingredients
      for (const ingredient of recipe.ingredients) {
        const requiredQty = new Decimal(ingredient.quantity).mul(multiplier);

        // find cost (simplified averageCost)
        const product = await tx.product.findUnique({ where: { id: ingredient.productId }});
        const unitCost = product?.averageCost || new Decimal(0);
        const cost = requiredQty.mul(unitCost);
        totalCost = totalCost.add(cost);

        lines.push({
          productId: ingredient.productId,
          quantity: requiredQty,
          unitCost: unitCost,
        });

        // Current stock balance
        const balance = await tx.stockBalance.findFirst({
          where: { productId: ingredient.productId, warehouseId: data.warehouseId }
        });
        
        const beforeQty = balance?.onHand || new Decimal(0);
        const afterQty = beforeQty.minus(requiredQty);

        balanceUpdates.push(
          tx.stockBalance.upsert({
            where: {
               productId_warehouseId_locationId: {
                 productId: ingredient.productId,
                 warehouseId: data.warehouseId,
                 locationId: ""
               }
            },
            create: {
              productId: ingredient.productId,
              warehouseId: data.warehouseId,
              onHand: afterQty,
              available: afterQty,
            },
            update: {
              onHand: afterQty,
              available: afterQty,
            }
          })
        );

        stockMovements.push({
          companyId: req.user!.companyId,
          branchId: data.branchId,
          warehouseId: data.warehouseId,
          reference,
          type: "PRODUCTION_CONSUMPTION",
          productId: ingredient.productId,
          quantity: requiredQty,
          beforeQty,
          afterQty,
          unitCost,
          totalCost: cost,
          userId: req.user!.id,
        });
      }

      // 2. Add output product
      const outputProduct = await tx.product.findUnique({ where: { id: recipe.productId }});
      const outputUnitCost = totalCost.dividedBy(data.outputQty);
      
      const outputBalance = await tx.stockBalance.findFirst({
        where: { productId: recipe.productId, warehouseId: data.warehouseId }
      });
      const beforeOutputQty = outputBalance?.onHand || new Decimal(0);
      const afterOutputQty = beforeOutputQty.add(data.outputQty);
      
      balanceUpdates.push(
        tx.stockBalance.upsert({
          where: {
             productId_warehouseId_locationId: {
               productId: recipe.productId,
               warehouseId: data.warehouseId,
               locationId: ""
             }
          },
          create: {
            productId: recipe.productId,
            warehouseId: data.warehouseId,
            onHand: afterOutputQty,
            available: afterOutputQty,
            averageCost: outputUnitCost,
          },
          update: {
            onHand: afterOutputQty,
            available: afterOutputQty,
            // Recalculate average cost
            averageCost: (beforeOutputQty.mul(outputBalance?.averageCost || new Decimal(0)).add(totalCost)).dividedBy(afterOutputQty)
          }
        })
      );
      
      stockMovements.push({
          companyId: req.user!.companyId,
          branchId: data.branchId,
          warehouseId: data.warehouseId,
          reference,
          type: "PRODUCTION_OUTPUT",
          productId: recipe.productId,
          quantity: data.outputQty,
          beforeQty: beforeOutputQty,
          afterQty: afterOutputQty,
          unitCost: outputUnitCost,
          totalCost: totalCost,
          userId: req.user!.id,
      });

      // 3. Create run
      const run = await tx.productionRun.create({
        data: {
          companyId: req.user!.companyId,
          branchId: data.branchId,
          warehouseId: data.warehouseId,
          reference,
          recipeId: data.recipeId,
          status: "COMPLETED",
          outputQty: data.outputQty,
          totalCost: totalCost,
          createdById: req.user!.id,
          lines: {
            create: lines
          }
        }
      });

      // Execute balance updates
      await Promise.all(balanceUpdates);
      
      // Execute movements
      // @ts-ignore
      await tx.stockMovement.createMany({ data: stockMovements });

      return run;
    });

    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Production run failed" });
  }
});

export default router;
