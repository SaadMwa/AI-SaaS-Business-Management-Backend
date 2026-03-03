import { Product } from "../models/product";
import { logger } from "../utils/logger";

export type StoreSearchFilters = {
  productName?: string | null;
  category?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
};

export type StoreSearchQueryLog = {
  filter: Record<string, unknown>;
  sort: Record<string, 1 | -1>;
  limit: number;
  reason: string;
};

type ProductRecord = {
  _id: { toString: () => string } | string;
  name: string;
  description: string;
  price: number;
  stock_quantity: number;
  image_url: string;
  category?: string;
  is_recommended?: boolean;
  top_selling?: boolean;
  popularity_score?: number;
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizePriceBounds = (minPrice?: number | null, maxPrice?: number | null) => {
  const min = Number.isFinite(minPrice as number) ? Number(minPrice) : null;
  const max = Number.isFinite(maxPrice as number) ? Number(maxPrice) : null;
  if (min !== null && max !== null && min > max) {
    return { min: max, max: min };
  }
  return { min, max };
};

const buildSearchFilter = (storeId: string, filters: StoreSearchFilters) => {
  const and: Record<string, unknown>[] = [];
  const trimmedName = (filters.productName || "").trim();
  if (trimmedName) {
    const regex = new RegExp(escapeRegex(trimmedName), "i");
    and.push({
      $or: [{ name: regex }, { description: regex }, { category: regex }],
    });
  }

  const trimmedCategory = (filters.category || "").trim();
  if (trimmedCategory) {
    const regex = new RegExp(escapeRegex(trimmedCategory), "i");
    and.push({ category: regex });
  }

  const { min, max } = normalizePriceBounds(filters.minPrice, filters.maxPrice);
  if (min !== null || max !== null) {
    const priceFilter: Record<string, number> = {};
    if (min !== null) priceFilter.$gte = min;
    if (max !== null) priceFilter.$lte = max;
    and.push({ price: priceFilter });
  }

  const filter: Record<string, unknown> = { store_id: storeId };
  if (and.length) filter.$and = and;
  return { filter, hasFilters: and.length > 0 };
};

const DEFAULT_SELECT =
  "name description price stock_quantity image_url category is_recommended top_selling popularity_score";

const DEFAULT_LIMIT = 8;

export const storeProductSearchService = {
  async search(
    storeId: string,
    filters: StoreSearchFilters,
    limit = DEFAULT_LIMIT
  ): Promise<{ products: ProductRecord[]; queryLog: StoreSearchQueryLog }> {
    const { filter, hasFilters } = buildSearchFilter(storeId, filters);
    const sanitizedLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : DEFAULT_LIMIT;

    if (!hasFilters) {
      const topSellerFilter = { ...filter, top_selling: true };
      const topSellerSort = { popularity_score: -1, createdAt: -1 } as const;
      logger.info("store_search_query", {
        filter: topSellerFilter,
        sort: topSellerSort,
        limit: sanitizedLimit,
        reason: "no_filters_top_sellers",
      });
      const topSellers = (await Product.find(topSellerFilter)
        .select(DEFAULT_SELECT)
        .sort(topSellerSort)
        .limit(sanitizedLimit)
        .lean()
        .maxTimeMS(10000)) as ProductRecord[];

      if (topSellers.length) {
        return {
          products: topSellers,
          queryLog: {
            filter: topSellerFilter,
            sort: topSellerSort,
            limit: sanitizedLimit,
            reason: "no_filters_top_sellers",
          },
        };
      }
    }

    const sort = hasFilters
      ? ({ popularity_score: -1, top_selling: -1, createdAt: -1 } as const)
      : ({ top_selling: -1, popularity_score: -1, createdAt: -1 } as const);

    logger.info("store_search_query", {
      filter,
      sort,
      limit: sanitizedLimit,
      reason: hasFilters ? "filtered_search" : "fallback_all_products",
    });

    const products = (await Product.find(filter)
      .select(DEFAULT_SELECT)
      .sort(sort)
      .limit(sanitizedLimit)
      .lean()
      .maxTimeMS(10000)) as ProductRecord[];

    return {
      products,
      queryLog: {
        filter,
        sort,
        limit: sanitizedLimit,
        reason: hasFilters ? "filtered_search" : "fallback_all_products",
      },
    };
  },
};
