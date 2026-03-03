import { Router } from "express";
import { authenticate, requireAdmin } from "../middlewares/auth.middleware";
import {
  createProduct,
  deleteProduct,
  getProducts,
  getProductRecommendations,
  generateProductAiContent,
  searchStoreProducts,
  updateProduct,
} from "../controllers/product.controller";

const router = Router();

router.get("/", getProducts);
router.get("/search", searchStoreProducts);
router.get("/recommendations", getProductRecommendations);
router.post("/ai-content", authenticate, requireAdmin, generateProductAiContent);
router.post("/", authenticate, requireAdmin, createProduct);
router.put("/:id", authenticate, requireAdmin, updateProduct);
router.delete("/:id", authenticate, requireAdmin, deleteProduct);

export default router;
