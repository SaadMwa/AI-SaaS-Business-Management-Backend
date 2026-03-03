import mongoose from "mongoose";
import { Product } from "../models/product";
import { Sale } from "../models/sale";

type ProductRecord = {
  _id: mongoose.Types.ObjectId | string;
  name: string;
  description: string;
  price: number;
  stock_quantity: number;
  image_url: string;
  category?: string;
  popularity_score?: number;
  top_selling?: boolean;
  total_sold?: number;
  last_sold_at?: Date;
};

const PRODUCT_SELECT =
  "name description price stock_quantity image_url category popularity_score top_selling total_sold last_sold_at";

const normalizeName = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const mapByName = (products: ProductRecord[]) => {
  const map = new Map<string, ProductRecord>();
  products.forEach((product) => {
    map.set(normalizeName(product.name), product);
  });
  return map;
};

const resolveProductsByName = async (storeId: string, names: string[]) => {
  if (!names.length) return [];
  const regexes = names.map((name) => new RegExp(`^${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}$`, "i"));
  const products = (await Product.find({ store_id: storeId, name: { $in: regexes } })
    .select(PRODUCT_SELECT)
    .lean()
    .maxTimeMS(10000)) as ProductRecord[];
  const byName = mapByName(products);
  return names
    .map((name) => byName.get(normalizeName(name)))
    .filter(Boolean) as ProductRecord[];
};

const getNewArrivals = async (storeId: string, limit: number) => {
  return (await Product.find({ store_id: storeId })
    .select(PRODUCT_SELECT)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean()
    .maxTimeMS(10000)) as ProductRecord[];
};

const getAnyInStockProducts = async (storeId: string, limit: number) => {
  return (await Product.find({ store_id: storeId, stock_quantity: { $gt: 0 } })
    .select(PRODUCT_SELECT)
    .sort({ stock_quantity: -1, createdAt: -1 })
    .limit(limit)
    .lean()
    .maxTimeMS(10000)) as ProductRecord[];
};

const logRecommendation = (intentType: string, category: string | null, source: string, count: number) => {
  console.log(`[RECOMMENDATION] Intent: ${intentType}`);
  console.log(`[RECOMMENDATION] Category: ${category || "none"}`);
  console.log(`[RECOMMENDATION] Source: ${source}`);
  console.log(`[RECOMMENDATION] Products returned: ${count}`);
};

export type RecommendationOptions = {
  limit?: number;
  category?: string | null;
  minPrice?: number;
  maxPrice?: number;
};

export interface IRecommendationEngine {
  getTopSellingProducts(storeId: string, options?: RecommendationOptions): Promise<ProductRecord[]>;
  getTrendingProducts(storeId: string, options?: RecommendationOptions): Promise<ProductRecord[]>;
  getCategoryRecommendations(
    storeId: string,
    category: string,
    options?: RecommendationOptions
  ): Promise<ProductRecord[]>;
  getSimilarProducts(storeId: string, productId: string, limit: number): Promise<ProductRecord[]>;
  getLowStockProducts(storeId: string, threshold: number, limit: number): Promise<ProductRecord[]>;
  getDefaultRecommendations(storeId: string, limit: number): Promise<ProductRecord[]>;
  getRecommendations(
    storeId: string,
    options?: RecommendationOptions
  ): Promise<{ products: ProductRecord[]; source: string }>;
}

export const recommendationEngine: IRecommendationEngine = {
  async getTopSellingProducts(storeId, options = {}) {
    const {
      limit = 5,
      category = null,
      minPrice = 0,
      maxPrice = Number.POSITIVE_INFINITY,
    } = options;

    console.log(
      `🔍 Top sellers with price: $${minPrice} - ${maxPrice === Number.POSITIVE_INFINITY ? "∞" : `$${maxPrice}`}`
    );

    const salesAgg = await Sale.aggregate([
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.name",
          totalSold: { $sum: "$items.quantity" },
          lastSold: { $max: "$createdAt" },
        },
      },
      { $sort: { totalSold: -1, lastSold: -1 } },
      { $limit: limit },
    ]).option({ maxTimeMS: 10000 });

    const names = salesAgg.map((row) => String(row._id || "")).filter(Boolean);
    let products = await resolveProductsByName(storeId, names);
    if (category) {
      const categoryRegex = new RegExp(category.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&"), "i");
      products = products.filter((product) => categoryRegex.test(product.category || ""));
    }
    products = products.filter((product) => {
      const price = Number(product.price || 0);
      return price >= minPrice && price <= maxPrice;
    });

    console.log(`📦 Found ${products.length} products within price range`);

    if (products.length === 0) {
      return this.getTrendingProducts(storeId, options);
    }

    return products;
  },

  async getTrendingProducts(storeId, options = {}) {
    const {
      limit = 5,
      category = null,
      minPrice = 0,
      maxPrice = Number.POSITIVE_INFINITY,
    } = options;
    const query: Record<string, unknown> = {
      store_id: storeId,
      price: { $gte: minPrice, $lte: maxPrice },
    };
    if (category) {
      query.category = new RegExp(category.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&"), "i");
    }
    return (await Product.find(query)
      .select(PRODUCT_SELECT)
      .sort({ popularity_score: -1, updatedAt: -1 })
      .limit(limit)
      .lean()
      .maxTimeMS(10000)) as ProductRecord[];
  },

  async getCategoryRecommendations(storeId, category, options = {}) {
    const {
      limit = 3,
      minPrice = 0,
      maxPrice = Number.POSITIVE_INFINITY,
    } = options;
    const regex = new RegExp(category.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&"), "i");
    return (await Product.find({
      store_id: storeId,
      category: regex,
      price: { $gte: minPrice, $lte: maxPrice },
    })
      .select(PRODUCT_SELECT)
      .sort({ popularity_score: -1, top_selling: -1, createdAt: -1 })
      .limit(limit)
      .lean()
      .maxTimeMS(10000)) as ProductRecord[];
  },

  async getSimilarProducts(storeId, productId, limit) {
    const base = await Product.findOne({ _id: productId, store_id: storeId })
      .select("category")
      .lean()
      .maxTimeMS(10000);
    if (!base?.category) return [];
    return (await Product.find({
      store_id: storeId,
      category: base.category,
      _id: { $ne: productId },
    })
      .select(PRODUCT_SELECT)
      .sort({ popularity_score: -1, top_selling: -1 })
      .limit(limit)
      .lean()
      .maxTimeMS(10000)) as ProductRecord[];
  },

  async getLowStockProducts(storeId, threshold, limit) {
    return (await Product.find({
      store_id: storeId,
      stock_quantity: { $gt: 0, $lte: threshold },
    })
      .select(PRODUCT_SELECT)
      .sort({ stock_quantity: 1 })
      .limit(limit)
      .lean()
      .maxTimeMS(10000)) as ProductRecord[];
  },

  async getDefaultRecommendations(storeId, limit) {
    const arrivals = await getNewArrivals(storeId, limit);
    if (arrivals.length) return arrivals;
    return await getAnyInStockProducts(storeId, limit);
  },

  async getRecommendations(storeId, options = {}) {
    const { limit = 5 } = options;
    let products = await this.getTopSellingProducts(storeId, { ...options, limit });
    if (products.length) return { products, source: "sales" };

    products = await this.getTrendingProducts(storeId, { ...options, limit });
    if (products.length) return { products, source: "popularity" };

    products = await getNewArrivals(storeId, limit);
    if (products.length) return { products, source: "new_arrivals" };

    products = await getAnyInStockProducts(storeId, limit);
    return { products, source: "inventory" };
  },
};

export const recommendationLogger = {
  log(intentType: string, category: string | null, source: string, count: number) {
    logRecommendation(intentType, category, source, count);
  },
};
