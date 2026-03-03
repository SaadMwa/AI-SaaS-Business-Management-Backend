import { Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import { Product } from "../models/product";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { productIntelligenceService } from "../services/product-intelligence.service";
import { productAiService } from "../services/product-ai.service";
import { storeProductSearchService } from "../services/store-product-search.service";

const normalizeStoreId = (value: unknown) => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
};

const mapProductPayload = (body: Record<string, unknown>) => {
  return {
    name: typeof body.name === "string" ? body.name.trim() : "",
    description: typeof body.description === "string" ? body.description.trim() : "",
    price: Number(body.price),
    stock_quantity: Number(body.stock_quantity),
    image_url: typeof body.image_url === "string" ? body.image_url.trim() : "",
    category: typeof body.category === "string" ? body.category.trim() : "General",
    is_recommended: Boolean(body.is_recommended),
    popularity_score: Number(body.popularity_score ?? 50),
    top_selling: Boolean(body.top_selling),
  };
};

const validateProductPayload = (payload: ReturnType<typeof mapProductPayload>) => {
  if (!payload.name) return "Product name is required";
  if (!payload.description) return "Description is required";
  if (!Number.isFinite(payload.price) || payload.price < 0) return "Price must be a valid number";
  if (!Number.isFinite(payload.stock_quantity) || payload.stock_quantity < 0) {
    return "Stock quantity must be a valid number";
  }
  if (!payload.image_url) return "Image URL is required";
  if (!Number.isFinite(payload.popularity_score) || payload.popularity_score < 0) {
    return "Popularity score must be a valid number";
  }
  return null;
};

export const getProducts = async (req: AuthRequest, res: Response) => {
  try {
    const requestedStoreId = normalizeStoreId(req.query.store_id);
    const storeId = requestedStoreId || req.user?.store_id || env.demoStoreId;
    const intelligence = await productIntelligenceService.getStoreIntelligence(
      storeId,
      typeof req.query.q === "string" ? req.query.q : undefined
    );
    return res.json({
      success: true,
      products: intelligence.products,
      featuredProducts: intelligence.featuredProducts,
      bestSellers: intelligence.bestSellers,
      lowStockAlerts: intelligence.lowStockAlerts,
      smartSuggestions: intelligence.smartSuggestions,
      categories: intelligence.categories,
    });
  } catch (error) {
    logger.error("product_list_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to fetch products" });
  }
};

export const searchStoreProducts = async (req: AuthRequest, res: Response) => {
  try {
    const requestedStoreId = normalizeStoreId(req.query.store_id);
    const storeId = requestedStoreId || req.user?.store_id || env.demoStoreId;
    const productName = typeof req.query.product_name === "string" ? req.query.product_name : null;
    const category = typeof req.query.category === "string" ? req.query.category : null;
    const minPrice =
      typeof req.query.min_price === "string" ? Number(req.query.min_price) : null;
    const maxPrice =
      typeof req.query.max_price === "string" ? Number(req.query.max_price) : null;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;

    const { products, queryLog } = await storeProductSearchService.search(
      storeId,
      {
        productName,
        category,
        minPrice,
        maxPrice,
      },
      limit
    );

    return res.json({
      success: true,
      products,
      query: queryLog,
    });
  } catch (error) {
    logger.error("product_search_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to search products" });
  }
};

export const getProductRecommendations = async (req: AuthRequest, res: Response) => {
  try {
    const requestedStoreId = normalizeStoreId(req.query.store_id);
    const storeId = requestedStoreId || req.user?.store_id || env.demoStoreId;
    const query = typeof req.query.q === "string" ? req.query.q : undefined;
    const productId = typeof req.query.productId === "string" ? req.query.productId : undefined;

    const intelligence = await productIntelligenceService.getStoreIntelligence(
      storeId,
      query,
      productId
    );

    return res.json({
      success: true,
      seedProductId: intelligence.seedProductId,
      recommendations: intelligence.recommendations,
      featuredProducts: intelligence.featuredProducts,
      bestSellers: intelligence.bestSellers,
      lowStockAlerts: intelligence.lowStockAlerts,
      smartSuggestions: intelligence.smartSuggestions,
    });
  } catch (error) {
    logger.error("product_recommendations_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to fetch recommendations" });
  }
};

export const createProduct = async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: "Unauthorized" });

    const payload = mapProductPayload(req.body || {});
    const validationError = validateProductPayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const created = await Product.create({
      ...payload,
      store_id: user.store_id,
      createdBy: user.userId,
    });

    return res.status(201).json({ success: true, product: created });
  } catch (error) {
    logger.error("product_create_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to create product" });
  }
};

export const updateProduct = async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: "Unauthorized" });

    const payload = mapProductPayload(req.body || {});
    const validationError = validateProductPayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const updated = await Product.findOneAndUpdate(
      { _id: req.params.id, store_id: user.store_id },
      payload,
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    return res.json({ success: true, product: updated });
  } catch (error) {
    logger.error("product_update_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to update product" });
  }
};

export const deleteProduct = async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: "Unauthorized" });

    const deleted = await Product.findOneAndDelete({ _id: req.params.id, store_id: user.store_id });
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    return res.json({ success: true, message: "Product deleted" });
  } catch (error) {
    logger.error("product_delete_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to delete product" });
  }
};

export const generateProductAiContent = async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: "Unauthorized" });

    const {
      type,
      name,
      category,
      price,
      keywords,
      description,
    } = (req.body || {}) as {
      type?: "description" | "caption";
      name?: string;
      category?: string;
      price?: number | string;
      keywords?: string;
      description?: string;
    };

    if (!type || !["description", "caption"].includes(type)) {
      return res.status(400).json({ success: false, message: "Invalid generation type" });
    }
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: "Product name is required" });
    }

    const numericPrice =
      typeof price === "number" ? price : typeof price === "string" ? Number(price) : undefined;
    const safePrice = Number.isFinite(numericPrice) ? Number(numericPrice) : undefined;

    const content =
      type === "description"
        ? await productAiService.generateDescription({
            name: String(name).trim(),
            category: category ? String(category).trim() : undefined,
            price: safePrice,
            keywords: keywords ? String(keywords).trim() : undefined,
          })
        : await productAiService.generateMarketingCaption({
            name: String(name).trim(),
            category: category ? String(category).trim() : undefined,
            price: safePrice,
            description: description ? String(description).trim() : undefined,
          });

    return res.json({ success: true, content });
  } catch (error) {
    logger.error("product_ai_generation_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to generate AI content" });
  }
};
