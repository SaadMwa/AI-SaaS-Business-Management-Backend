import { Product } from "../models/product";
import { Sale } from "../models/sale";

type ProductLean = {
  _id: { toString: () => string } | string;
  name: string;
  description: string;
  price: number;
  stock_quantity: number;
  image_url: string;
  category?: string;
  is_recommended?: boolean;
  popularity_score?: number;
  top_selling?: boolean;
  store_id: string;
};

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "your",
  "our",
  "you",
  "are",
  "have",
  "has",
  "into",
  "about",
  "over",
  "under",
  "new",
]);

const normalizeTokens = (value: string) =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));

const toId = (value: unknown) =>
  typeof value === "string" ? value : (value as { toString?: () => string })?.toString?.() || "";

const overlapScore = (left: Set<string>, right: Set<string>) => {
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  left.forEach((token) => {
    if (right.has(token)) overlap += 1;
  });
  return overlap / Math.max(left.size, right.size);
};

const buildTokens = (product: ProductLean) =>
  new Set(normalizeTokens(`${product.name} ${product.description} ${product.category || ""}`));

const buildTopSellerNameSet = async (storeId: string) => {
  const last90Days = new Date();
  last90Days.setDate(last90Days.getDate() - 90);
  const bestSellerRows = await Sale.aggregate([
    { $match: { createdAt: { $gte: last90Days } } },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.name",
        qty: { $sum: "$items.quantity" },
      },
    },
    { $sort: { qty: -1 } },
    { $limit: 20 },
  ]).option({ maxTimeMS: 10000 });

  const products = await Product.find({ store_id: storeId })
    .select("name")
    .lean()
    .maxTimeMS(10000);

  const productNames = new Map(products.map((p) => [p.name.toLowerCase(), p.name]));
  const topSellerNames = new Set<string>();

  bestSellerRows.forEach((row) => {
    const raw = String(row._id || "").toLowerCase();
    if (!raw) return;
    const direct = productNames.get(raw);
    if (direct) {
      topSellerNames.add(direct.toLowerCase());
      return;
    }
    const closest = Array.from(productNames.keys()).find(
      (name) => name.includes(raw) || raw.includes(name)
    );
    if (closest) topSellerNames.add(closest);
  });

  return topSellerNames;
};

const decorateProduct = (product: ProductLean, topSellerNames: Set<string>) => {
  const topSelling = topSellerNames.has(product.name.toLowerCase()) || Boolean(product.top_selling);
  const recommended = Boolean(product.is_recommended);
  const popularity = Number(product.popularity_score || 0);
  const featured = recommended || topSelling || popularity >= 75;
  return {
    ...product,
    _id: toId(product._id),
    top_selling: topSelling,
    is_recommended: recommended || featured,
    featured,
    low_stock: product.stock_quantity > 0 && product.stock_quantity <= 5,
  };
};

const rankBySimilarity = (
  products: Array<ReturnType<typeof decorateProduct>>,
  seed: ReturnType<typeof decorateProduct>,
  query: string
) => {
  const queryTokens = new Set(normalizeTokens(query));
  const seedTokens = buildTokens(seed as ProductLean);
  return products
    .filter((product) => product._id !== seed._id)
    .map((product) => {
      const productTokens = buildTokens(product as ProductLean);
      const bySeed = overlapScore(productTokens, seedTokens);
      const byQuery = queryTokens.size ? overlapScore(productTokens, queryTokens) : 0;
      const categoryBoost = product.category === seed.category ? 0.2 : 0;
      const score = bySeed * 0.6 + byQuery * 0.3 + categoryBoost + Number(product.popularity_score || 0) / 500;
      return { product, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((item) => item.product);
};

export const productIntelligenceService = {
  async getStoreIntelligence(storeId: string, searchQuery?: string, productId?: string) {
    const products = await Product.find({ store_id: storeId })
      .sort({ createdAt: -1 })
      .select("name description price stock_quantity image_url category is_recommended popularity_score top_selling store_id")
      .lean()
      .maxTimeMS(10000);

    const topSellerNames = await buildTopSellerNameSet(storeId);
    const decorated = products.map((product) => decorateProduct(product as ProductLean, topSellerNames));
    const bestSellers = decorated
      .filter((product) => product.top_selling)
      .sort((a, b) => Number(b.popularity_score || 0) - Number(a.popularity_score || 0))
      .slice(0, 8);
    const featuredProducts = decorated
      .filter((product) => product.featured)
      .sort((a, b) => Number(b.popularity_score || 0) - Number(a.popularity_score || 0))
      .slice(0, 8);
    const lowStockAlerts = decorated
      .filter((product) => product.low_stock)
      .sort((a, b) => a.stock_quantity - b.stock_quantity)
      .slice(0, 12);

    const query = (searchQuery || "").trim().toLowerCase();
    const categories = Array.from(
      new Set(
        decorated
          .map((product) => (product.category || "General").trim())
          .filter(Boolean)
      )
    ).sort();

    const smartSuggestions = query
      ? decorated
          .filter((product) => {
            const haystack = `${product.name} ${product.category || ""} ${product.description}`.toLowerCase();
            return haystack.includes(query);
          })
          .slice(0, 8)
          .map((product) => ({ id: product._id, label: product.name, category: product.category || "General" }))
      : decorated
          .slice(0, 8)
          .map((product) => ({ id: product._id, label: product.name, category: product.category || "General" }));

    const seed =
      decorated.find((product) => product._id === productId) ||
      (query
        ? decorated.find((product) =>
            `${product.name} ${product.description}`.toLowerCase().includes(query)
          )
        : undefined) ||
      featuredProducts[0] ||
      decorated[0];

    const recommendations = seed
      ? rankBySimilarity(decorated, seed, query || seed.name).slice(0, 8)
      : [];

    if (decorated.length) {
      const ops = decorated
        .filter((product) => product.top_selling !== Boolean((products.find((p) => toId(p._id) === product._id) as any)?.top_selling) || product.is_recommended !== Boolean((products.find((p) => toId(p._id) === product._id) as any)?.is_recommended))
        .slice(0, 100)
        .map((product) => ({
          updateOne: {
            filter: { _id: product._id, store_id: storeId },
            update: {
              $set: {
                top_selling: product.top_selling,
                is_recommended: product.is_recommended,
              },
            },
          },
        }));
      if (ops.length) {
        await Product.bulkWrite(ops, { ordered: false });
      }
    }

    return {
      products: decorated,
      featuredProducts,
      bestSellers,
      lowStockAlerts,
      recommendations,
      smartSuggestions,
      categories,
      seedProductId: seed?._id || null,
    };
  },
};

