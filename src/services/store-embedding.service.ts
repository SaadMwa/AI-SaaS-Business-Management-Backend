import { env } from "../config/env";
import { logger } from "../utils/logger";

type ProductEmbeddingInput = {
  _id: { toString: () => string } | string;
  name: string;
  description?: string;
  category?: string;
  embedding?: number[];
};

const toId = (value: ProductEmbeddingInput["_id"]) =>
  typeof value === "string" ? value : value.toString();

const cleanVector = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
};

const toEmbeddingText = (product: { name: string; description?: string; category?: string }) =>
  `${product.name}. ${product.category || "General"}. ${product.description || ""}`.trim();

const callOpenAiEmbedding = async (text: string) => {
  if (!env.openaiApiKey) return null;
  const model = env.openaiEmbeddingModel || "text-embedding-3-small";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.openaiApiKey}`,
      },
      body: JSON.stringify({ model, input: text }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      logger.warn("store_embedding_openai_http_error", {
        status: response.status,
        body: body.slice(0, 500),
      });
      return null;
    }
    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    return cleanVector(payload.data?.[0]?.embedding);
  } catch (error) {
    logger.warn("store_embedding_openai_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const callGeminiEmbedding = async (text: string) => {
  if (!env.geminiApiKey) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiEmbeddingModel}:embedContent`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.geminiApiKey,
      },
      body: JSON.stringify({
        content: {
          parts: [{ text }],
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      logger.warn("store_embedding_gemini_http_error", {
        status: response.status,
        body: body.slice(0, 500),
      });
      return null;
    }
    const payload = (await response.json()) as {
      embedding?: { values?: number[] };
    };
    return cleanVector(payload.embedding?.values);
  } catch (error) {
    logger.warn("store_embedding_gemini_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const dotProduct = (a: number[], b: number[]) => {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i += 1) {
    sum += a[i] * b[i];
  }
  return sum;
};

const vectorMagnitude = (v: number[]) => Math.sqrt(v.reduce((acc, value) => acc + value * value, 0));

export const cosineSimilarity = (a: number[], b: number[]) => {
  if (!a.length || !b.length) return 0;
  const mag = vectorMagnitude(a) * vectorMagnitude(b);
  if (!mag) return 0;
  return dotProduct(a, b) / mag;
};

export const storeEmbeddingService = {
  async embedText(text: string): Promise<number[]> {
    const trimmed = text.trim();
    if (!trimmed) return [];
    const openAiVector = await callOpenAiEmbedding(trimmed);
    if (openAiVector && openAiVector.length) return openAiVector;
    const geminiVector = await callGeminiEmbedding(trimmed);
    return geminiVector || [];
  },

  async ensureProductEmbeddings<T extends ProductEmbeddingInput>(
    products: T[],
    save: (updates: Array<{ id: string; embedding: number[] }>) => Promise<void>
  ): Promise<Array<T & { embedding: number[] }>> {
    const updates: Array<{ id: string; embedding: number[] }> = [];
    const resolved: Array<T & { embedding: number[] }> = [];

    for (const product of products) {
      const existing = cleanVector(product.embedding);
      if (existing.length) {
        resolved.push({ ...product, embedding: existing });
        continue;
      }
      const embedding = await this.embedText(toEmbeddingText(product));
      if (embedding.length) {
        updates.push({ id: toId(product._id), embedding });
      }
      resolved.push({ ...product, embedding });
    }

    if (updates.length) {
      await save(updates);
    }

    return resolved;
  },
};
