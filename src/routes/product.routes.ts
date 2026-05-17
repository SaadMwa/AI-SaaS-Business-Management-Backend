import { Router } from "express";
import { authenticate, optionalAuthenticate, requireAdmin } from "../middlewares/auth.middleware";
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

router.get("/", optionalAuthenticate, getProducts);
router.get("/search", optionalAuthenticate, searchStoreProducts);
router.get("/recommendations", optionalAuthenticate, getProductRecommendations);
router.post("/ai-content", authenticate, requireAdmin, generateProductAiContent);
router.post("/", authenticate, requireAdmin, createProduct);
router.put("/:id", authenticate, requireAdmin, updateProduct);
router.delete("/:id", authenticate, requireAdmin, deleteProduct);

export default router;
