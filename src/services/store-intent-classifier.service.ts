import { env } from "../config/env";
import { logger } from "../utils/logger";
import { normalizeWithDictionary } from "../utils/fuzzy";

export type StoreIntent =
  | "product_search"
  | "recommendation"
  | "availability_check"
  | "greeting"
  | "other";

export type StoreIntentEntities = {
  product_name?: string;
  category?: string;
  min_price?: number | null;
  max_price?: number | null;
};

export type StoreIntentResult = {
  intent: StoreIntent;
  entities: StoreIntentEntities;
};

type OpenAiToolResponse = {
  choices?: Array<{
    message?: {
      tool_calls?: Array<{
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
};

const DEFAULT_RESULT: StoreIntentResult = { intent: "other", entities: {} };

const normalizeNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const sanitizeIntent = (value: unknown): StoreIntent => {
  const raw = typeof value === "string" ? value : "";
  if (
    raw === "product_search" ||
    raw === "recommendation" ||
    raw === "availability_check" ||
    raw === "greeting" ||
    raw === "other"
  ) {
    return raw;
  }
  return "other";
};

const sanitizeEntities = (value: unknown): StoreIntentEntities => {
  const payload = (typeof value === "object" && value ? value : {}) as {
    category?: unknown;
    max_price?: unknown;
    product_name?: unknown;
    min_price?: unknown;
  };
  const category =
    typeof payload.category === "string" ? payload.category.trim() : undefined;
  const productName =
    typeof payload.product_name === "string" ? payload.product_name.trim() : undefined;
  const minPrice = normalizeNumber(payload.min_price);
  const maxPrice = normalizeNumber(payload.max_price);
  return {
    category: category || undefined,
    min_price: minPrice,
    max_price: maxPrice,
    product_name: productName || undefined,
  };
};

const ENTITY_NORMALIZATION_DICTIONARY: Record<string, string> = {
  laptpo: "laptop",
  labtop: "laptop",
  leptop: "laptop",
  hedphones: "headphones",
  headpone: "headphones",
  hedphone: "headphones",
  earbud: "earbuds",
  earbods: "earbuds",
  smartfone: "smartphone",
  smarphone: "smartphone",
  watche: "watch",
  smarthwatch: "smartwatch",
  accesory: "accessory",
  accesories: "accessories",
};

const normalizeEntityText = (value?: string) => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return normalizeWithDictionary(trimmed, ENTITY_NORMALIZATION_DICTIONARY).replace(/\s+/g, " ");
};

const normalizeEntities = (entities: StoreIntentEntities): StoreIntentEntities => {
  return {
    product_name: normalizeEntityText(entities.product_name),
    category: normalizeEntityText(entities.category),
    min_price: Number.isFinite(entities.min_price as number) ? entities.min_price : null,
    max_price: Number.isFinite(entities.max_price as number) ? entities.max_price : null,
  };
};

const heuristicClassify = (message: string): StoreIntentResult => {
  const lower = message.toLowerCase();
  const minMatch = lower.match(/(?:over|above|minimum|at least)\s*\$?\s*(\d+(?:\.\d+)?)/i);
  const maxMatch = lower.match(/(?:under|below|max|less than|up to)\s*\$?\s*(\d+(?:\.\d+)?)/i);
  const extractedMin = minMatch ? Number(minMatch[1]) : null;
  const extractedMax = maxMatch ? Number(maxMatch[1]) : null;

  if (/^(hi|hello|hey|good morning|good afternoon|good evening)\b/i.test(lower)) {
    return { intent: "greeting", entities: {} };
  }

  if (/\b(recommend|best|top|suggest)\b/i.test(lower)) {
    return {
      intent: "recommendation",
      entities: {
        min_price: extractedMin,
        max_price: extractedMax,
      },
    };
  }

  if (/\b(stock|in stock|available|availability|do you have)\b/i.test(lower)) {
    return {
      intent: "availability_check",
      entities: {
        min_price: extractedMin,
        max_price: extractedMax,
      },
    };
  }

  if (/\b(how much|price|cost|under|below|above|over)\b/i.test(lower)) {
    return {
      intent: "product_search",
      entities: {
        min_price: extractedMin,
        max_price: extractedMax,
      },
    };
  }

  const tokens = lower
    .replace(/[$,]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const stop = new Set([
    "i",
    "need",
    "want",
    "show",
    "find",
    "search",
    "looking",
    "for",
    "a",
    "an",
    "the",
    "please",
    "any",
    "have",
    "do",
    "you",
    "with",
    "me",
  ]);
  const keywords = tokens.filter((token) => !stop.has(token));
  if (keywords.length) {
    return {
      intent: "product_search",
      entities: {
        product_name: keywords.join(" "),
        min_price: extractedMin,
        max_price: extractedMax,
      },
    };
  }

  return DEFAULT_RESULT;
};

const callOpenAiClassifier = async (
  message: string,
  history: Array<{ role: "user" | "assistant"; text: string }>
) => {
  if (!env.openaiApiKey) {
    return null;
  }

  const model = env.openaiIntentModel || "gpt-4o-mini";
  const url = "https://api.openai.com/v1/chat/completions";
  const historyLines = history
    .slice(-5)
    .map((entry) => `${entry.role}: ${entry.text}`)
    .join("\n");

  const body = {
    model,
    temperature: 0,
    tool_choice: {
      type: "function",
      function: { name: "extract_store_intent" },
    },
    tools: [
      {
        type: "function",
        function: {
          name: "extract_store_intent",
          description: "Extract store user intent and entities in strict JSON only.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              intent: {
                type: "string",
                enum: [
                  "product_search",
                  "recommendation",
                  "availability_check",
                  "greeting",
                  "other",
                ],
              },
              entities: {
                type: "object",
                additionalProperties: false,
                properties: {
                  product_name: { type: ["string", "null"] },
                  category: { type: ["string", "null"] },
                  min_price: { type: ["number", "null"] },
                  max_price: { type: ["number", "null"] },
                },
              },
            },
            required: ["intent", "entities"],
          },
        },
      },
    ],
    messages: [
      {
        role: "system",
        content:
          [
            "You are the intent and entity extractor for a store assistant.",
            "Return STRICT JSON only via the tool call.",
            "No natural language, no explanations, no markdown.",
            "Normalize spelling mistakes in product_name and category.",
            "If no clear intent, return intent = other and empty entities.",
          ].join(" "),
      },
      {
        role: "user",
        content: [
          historyLines ? `Recent conversation:\n${historyLines}` : "Recent conversation: none",
          `Current user message: ${message}`,
        ].join("\n\n"),
      },
    ],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.openaiApiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      logger.warn("store_intent_openai_http_error", {
        status: response.status,
        body: text.slice(0, 800),
      });
      return null;
    }

    const rawText = await response.text();
    logger.debug("store_intent_raw_response", { raw: rawText.slice(0, 2000) });
    const parsed = JSON.parse(rawText) as OpenAiToolResponse;
    const args =
      parsed.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments || "";
    if (!args) {
      return null;
    }

    const toolPayload = JSON.parse(args) as {
      intent?: unknown;
      entities?: unknown;
    };

    const sanitized = {
      intent: sanitizeIntent(toolPayload.intent),
      entities: sanitizeEntities(toolPayload.entities),
    } as StoreIntentResult;
    return {
      intent: sanitized.intent,
      entities: normalizeEntities(sanitized.entities),
    };
  } catch (error) {
    logger.warn("store_intent_openai_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

export const storeIntentClassifierService = {
  async classify(
    message: string,
    history: Array<{ role: "user" | "assistant"; text: string }> = []
  ): Promise<StoreIntentResult> {
    const aiResult = await callOpenAiClassifier(message, history);
    if (aiResult) return aiResult;
    const heuristic = heuristicClassify(message);
    return {
      intent: heuristic.intent,
      entities: normalizeEntities(heuristic.entities),
    };
  },
};
