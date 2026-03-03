import { env } from "../../config/env";
import { AgentMemory } from "../../models/agentMemory";
import { logger } from "../../utils/logger";

const cosineSimilarity = (a: number[], b: number[]) => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

const embedText = async (text: string): Promise<number[]> => {
  if (!env.geminiApiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const model = env.geminiEmbeddingModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`;
  const fetchFn =
    typeof fetch === "function"
      ? fetch
      : ((await import("node-fetch")).default as unknown as typeof fetch);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.geminiApiKey,
      },
      body: JSON.stringify({
        content: { parts: [{ text }] },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const textBody = await response.text();
      throw new Error(`Gemini embedding error: ${response.status} ${textBody}`);
    }

    const data = (await response.json()) as { embedding?: { values?: number[] } };
    return data.embedding?.values || [];
  } catch (error) {
    logger.warn("gemini_embedding_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export const memoryService = {
  addShortTerm: async (
    userId: string,
    sessionId: string,
    content: string,
    metadata: Record<string, unknown> = {}
  ) => {
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    return AgentMemory.create({
      userId,
      sessionId,
      type: "short_term",
      content,
      metadata,
      expiresAt,
    });
  },

  getShortTerm: async (userId: string, sessionId: string, limit = 10) => {
    return AgentMemory.find({
      userId,
      sessionId,
      type: "short_term",
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }],
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  },

  addLongTerm: async (
    userId: string,
    key: string,
    content: string,
    metadata: Record<string, unknown> = {}
  ) => {
    return AgentMemory.findOneAndUpdate(
      { userId, type: "long_term", key },
      { content, metadata, type: "long_term", key },
      { upsert: true, new: true }
    );
  },

  addSemantic: async (
    userId: string,
    content: string,
    metadata: Record<string, unknown> = {}
  ) => {
    const embedding = await embedText(content);
    return AgentMemory.create({
      userId,
      type: "semantic",
      content,
      metadata,
      embedding,
    });
  },

  findSimilarSemantic: async (userId: string, query: string, limit = 5) => {
    const embedding = await embedText(query);
    const memories = await AgentMemory.find({ userId, type: "semantic" })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    const ranked = memories
      .map((mem) => ({
        ...mem,
        score: cosineSimilarity(embedding, mem.embedding || []),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return ranked;
  },

  savePendingConfirmation: async (userId: string, sessionId: string, payload: Record<string, unknown>) => {
    return AgentMemory.create({
      userId,
      sessionId,
      type: "pending_confirmation",
      key: "pending_confirmation",
      content: JSON.stringify(payload),
      metadata: payload,
    });
  },

  getPendingConfirmation: async (userId: string, sessionId: string) => {
    const entry = await AgentMemory.findOne({
      userId,
      sessionId,
      type: "pending_confirmation",
      key: "pending_confirmation",
    })
      .sort({ createdAt: -1 })
      .lean();

    return entry?.metadata || null;
  },

  clearPendingConfirmation: async (userId: string, sessionId: string) => {
    return AgentMemory.deleteMany({
      userId,
      sessionId,
      type: "pending_confirmation",
      key: "pending_confirmation",
    });
  },
};
