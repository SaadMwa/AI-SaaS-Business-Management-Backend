import { Product } from "../models/product";
import { logger } from "../utils/logger";

export type StoreIntent =
  | "AVAILABILITY"
  | "PRICE"
  | "RECOMMENDATION"
  | "GENERAL_BROWSE"
  | "GREETING"
  | "GOODBYE";

export type StoreAgentResponse = {
  intent: StoreIntent;
  type?: "TOP_SELLING" | "CATEGORY" | "TRENDING" | "DEFAULT";
  found: boolean;
  products: Array<{
    id: string;
    name: string;
    price: number;
    image: string;
    stock: number;
    image_url: string;
    stock_quantity: number;
    category: string;
    description: string;
    popularity_score: number;
  }>;
  search_term: string;
  message: string;
  product_id?: string;
  can_add_to_cart?: boolean;
};

type ProductRecord = {
  _id: { toString: () => string } | string;
  name: string;
  description: string;
  price: number;
  stock_quantity: number;
  image_url: string;
  category?: string;
  popularity_score?: number;
};

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "i",
  "need",
  "want",
  "show",
  "find",
  "search",
  "looking",
  "for",
  "please",
  "any",
  "have",
  "do",
  "you",
  "with",
  "me",
  "in",
  "stock",
  "available",
  "availability",
  "got",
  "is",
  "there",
  "what",
  "are",
  "your",
  "sell",
  "products",
  "product",
  "recommend",
  "best",
  "popular",
  "top",
  "selling",
  "trending",
  "favorite",
  "price",
  "cost",
  "pricing",
  "how",
  "much",
]);

const SEARCH_STOPWORDS = new Set([
  "do",
  "you",
  "have",
  "is",
  "there",
  "any",
  "please",
  "a",
  "an",
  "the",
  "i",
  "need",
  "want",
  "looking",
  "for",
  "show",
  "me",
  "can",
  "get",
  "sell",
  "in",
  "stock",
  "available",
  "under",
  "below",
  "less",
  "than",
  "over",
  "above",
  "between",
  "to",
  "recommend",
  "suggest",
  "best",
  "top",
  "popular",
  "trending",
  "favorite",
]);

const tokenize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);

const extractKeywords = (message: string) => {
  const tokens = tokenize(message).filter((token) => !STOPWORDS.has(token));
  return Array.from(new Set(tokens));
};

const extractProductQuery = (userInput: string) => {
  const input = userInput.toLowerCase();
  const query = input
    .replace(
      /^(do you have|do you sell|is there|i need|i want|looking for|got any|can i get)\s*/i,
      ""
    )
    .replace(/[?.!]$/, "")
    .trim();
  if (query.length < 3) return input;
  return query;
};

const extractSearchKeywords = (query: string) => {
  const normalized = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !SEARCH_STOPWORDS.has(token) && !/^\d+$/.test(token));
  const uniqueTokens = Array.from(new Set(tokens));
  const mainKeyword = uniqueTokens.length ? uniqueTokens[uniqueTokens.length - 1] : "";
  return { tokens: uniqueTokens, mainKeyword };
};

const extractPriceRange = (text: string) => {
  const lower = text.toLowerCase();
  let minPrice: number | null = null;
  let maxPrice: number | null = null;

  const underMatch = lower.match(/(?:under|less than|below|max|maximum|<=)\s*\$?(\d+)/);
  if (underMatch) maxPrice = Number(underMatch[1]);

  const aboveMatch = lower.match(/(?:above|more than|over|min|minimum|>=)\s*\$?(\d+)/);
  if (aboveMatch) minPrice = Number(aboveMatch[1]);

  const rangeMatch = lower.match(/\$?(\d+)\s*(?:-|to)\s*\$?(\d+)/);
  if (rangeMatch) {
    minPrice = Number(rangeMatch[1]);
    maxPrice = Number(rangeMatch[2]);
  }

  return { minPrice, maxPrice };
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const classifyIntent = (message: string): StoreIntent => {
  const lower = message.toLowerCase();
  if (/(^|\b)(hi|hello|hey|good morning|good afternoon|good evening)\b/i.test(lower)) {
    return "GREETING";
  }
  if (/(^|\b)(bye|goodbye|see you|thanks|thank you)\b/i.test(lower)) {
    return "GOODBYE";
  }
  if (/(do you have|is there|i need|looking for|got any|available)/i.test(lower)) {
    return "AVAILABILITY";
  }
  if (/(how much|price of|what does it cost|cost of|pricing)/i.test(lower)) {
    return "PRICE";
  }
  if (/(recommend|suggest|best|top|popular|trending|favorite|bestseller|best seller)/i.test(lower)) {
    return "RECOMMENDATION";
  }
  return "GENERAL_BROWSE";
};

const toCards = (products: ProductRecord[]) =>
  products.map((product) => ({
    id: product._id.toString(),
    name: product.name,
    price: product.price,
    image: product.image_url,
    stock: product.stock_quantity,
    image_url: product.image_url,
    stock_quantity: product.stock_quantity,
    category: product.category || "General",
    description: product.description,
    popularity_score: Number(product.popularity_score || 0),
  }));

const formatProductStock = (stock: number) => (stock > 0 ? "In Stock" : "Out of Stock");

const searchProducts = async (storeId: string, query: string) => {
  const { tokens, mainKeyword } = extractSearchKeywords(query);
  const { minPrice, maxPrice } = extractPriceRange(query);
  const fallbackSearchTerm = extractProductQuery(query).trim();
  const keyword = mainKeyword || (tokens[0] || "");
  const displayKeyword = keyword || "products";

  logger.info("store_product_search_keyword", { keyword: displayKeyword, tokens, query, minPrice, maxPrice });

  if (!keyword && !tokens.length && minPrice === null && maxPrice === null) {
    logger.info("store_product_search_executed", {
      query: null,
      foundCount: 0,
    });
    return {
      keyword: fallbackSearchTerm || displayKeyword,
      products: [] as ProductRecord[],
    };
  }

  const mongoQuery: Record<string, unknown> = { store_id: storeId };
  const andClauses: Array<Record<string, unknown>> = [];

  if (keyword || tokens.length) {
    const regexTokens = (tokens.length ? tokens : [keyword]).map((token) => escapeRegex(token)).filter(Boolean);
    const combinedRegex = new RegExp(regexTokens.join("|"), "i");
    const keywordRegex = new RegExp(escapeRegex(keyword || regexTokens[0]), "i");
    andClauses.push({
      $or: [
        { name: { $regex: combinedRegex } },
        { description: { $regex: keywordRegex } },
        { category: { $regex: keywordRegex } },
      ],
    });
  }

  if (minPrice !== null || maxPrice !== null) {
    const priceFilter: Record<string, number> = {};
    if (minPrice !== null) priceFilter.$gte = minPrice;
    if (maxPrice !== null) priceFilter.$lte = maxPrice;
    andClauses.push({ price: priceFilter });
  }

  if (andClauses.length > 0) {
    mongoQuery.$and = andClauses;
  }

  logger.info("store_product_search_executed", {
    query: mongoQuery,
    keyword: displayKeyword,
    tokens,
    minPrice,
    maxPrice,
  });

  const products = (await Product.find(mongoQuery)
    .select("name description price category popularity_score top_selling stock_quantity image_url")
    .limit(5)
    .lean()
    .maxTimeMS(10000)) as ProductRecord[];

  logger.info("store_product_search_found", { keyword: displayKeyword, foundCount: products.length });

  return {
    keyword: displayKeyword,
    products,
  };
};

export const storeProductAgentService = {
  async answer(params: { storeId: string; message: string }): Promise<StoreAgentResponse> {
    const intent = classifyIntent(params.message);
    const searchTerm = extractProductQuery(params.message);
    const keywords = extractKeywords(params.message);

    logger.info("store_search_query", { intent, searchTerm, keywords });

    if (intent === "GREETING") {
      return {
        intent,
        found: false,
        products: [],
        search_term: searchTerm,
        message: "Hi. How can I help you today?",
      };
    }

    if (intent === "GOODBYE") {
      return {
        intent,
        found: false,
        products: [],
        search_term: searchTerm,
        message: "Thanks for stopping by.",
      };
    }

    const searchResult = await searchProducts(params.storeId, params.message);
    if (!searchResult.products.length) {
      return {
        intent,
        found: false,
        products: [],
        search_term: searchResult.keyword,
        message: `Sorry, we currently do not have ${searchResult.keyword} in stock.\nWould you like to explore similar electronics?`,
      };
    }

    const lowerMessage = params.message.toLowerCase();
    const isAvailabilityQuestion = /(do you have|have any|is there|available|in stock)/i.test(lowerMessage);
    const intro = isAvailabilityQuestion
      ? `Yes, we have the following ${searchResult.keyword} available:`
      : `Here are some ${searchResult.keyword} you might like:`;
    const productLines = searchResult.products.map((product) => {
      return `- ${product.name} - $${Number(product.price).toFixed(0)} - ${formatProductStock(product.stock_quantity)}`;
    });

    return {
      intent,
      found: true,
      products: toCards(searchResult.products),
      search_term: searchResult.keyword,
      message: `${intro}\n${productLines.join("\n")}`,
    };
  },
};
