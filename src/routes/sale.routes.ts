import { Router } from "express";
import { authenticate, requireAdmin } from "../middlewares/auth.middleware";
import {
  createSale,
  deleteSale,
  deleteSaleByNumber,
  getSaleById,
  getSaleByNumber,
  getSales,
  updateSale,
  updateSaleByNumber,
  assignSaleByNumber,
} from "../controllers/sale.controller";

const router = Router();

router.get("/", authenticate, requireAdmin, getSales);
router.post("/", authenticate, requireAdmin, createSale);
router.get("/number/:sale_number", authenticate, requireAdmin, getSaleByNumber);
router.get("/:id", authenticate, requireAdmin, getSaleById);
router.put("/number/:sale_number", authenticate, requireAdmin, updateSaleByNumber);
router.put("/:id", authenticate, requireAdmin, updateSale);
router.post("/number/:sale_number/assign", authenticate, requireAdmin, assignSaleByNumber);
router.delete("/number/:sale_number", authenticate, requireAdmin, deleteSaleByNumber);
router.delete("/:id", authenticate, requireAdmin, deleteSale);

export default router;
