import mongoose from "mongoose";
import { AiMemory } from "../models/aiMemory";
import { ChatMessage } from "../models/chatMessage";

const IMPORTANT_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "business_type", pattern: /\b(i run|we run|my business is|our business is)\b(.+)/i },
  { label: "business_type", pattern: /\b(i own|we own)\b(.+)/i },
  { label: "goals", pattern: /\b(our goal is|my goal is|we want to|i want to)\b(.+)/i },
  { label: "preferences", pattern: /\b(prefer|i prefer|we prefer)\b(.+)/i },
  { label: "decisions", pattern: /\b(we decided|i decided|we will|we're going to)\b(.+)/i },
];

const extractLongTermMemory = (message: string) => {
  const memory = [];
  for (const item of IMPORTANT_PATTERNS) {
    const match = message.match(item.pattern);
    if (match && match[0]) {
      memory.push(match[0].trim());
    }
  }
  return memory;
};

export const aiMemoryService = {
  saveChatMessage: async (userId: string, role: "user" | "ai", message: string) => {
    return ChatMessage.create({
      userId: new mongoose.Types.ObjectId(userId),
      role,
      message,
    });
  },

  getRecentChats: async (userId: string, limit = 20) => {
    const rows = await ChatMessage.find({ userId: new mongoose.Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return rows.reverse();
  },

  getChatCount: async (userId: string) => {
    return ChatMessage.countDocuments({ userId: new mongoose.Types.ObjectId(userId) });
  },

  getLongTermMemory: async (userId: string, limit = 20) => {
    const memories = await AiMemory.find({
      userId: new mongoose.Types.ObjectId(userId),
      memoryType: "long_term",
    })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();
    return memories.map((item) => item.content);
  },

  upsertLongTermMemory: async (userId: string, content: string) => {
    return AiMemory.findOneAndUpdate(
      { userId: new mongoose.Types.ObjectId(userId), memoryType: "long_term", content },
      { $set: { content } },
      { upsert: true, new: true }
    ).lean();
  },

  extractAndStoreLongTermMemory: async (userId: string, message: string) => {
    const memories = extractLongTermMemory(message);
    for (const memory of memories) {
      await aiMemoryService.upsertLongTermMemory(userId, memory);
    }
    return memories;
  },

  getConversationSummary: async (userId: string) => {
    const summary = await AiMemory.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      memoryType: "short_term",
    })
      .sort({ updatedAt: -1 })
      .lean();
    return summary?.content ?? null;
  },

  upsertConversationSummary: async (userId: string, content: string) => {
    return AiMemory.findOneAndUpdate(
      { userId: new mongoose.Types.ObjectId(userId), memoryType: "short_term" },
      { $set: { content } },
      { upsert: true, new: true }
    ).lean();
  },

  buildChatContext: async (
    userId: string,
    options: { recentLimit?: number; summaryTriggerCount?: number; summarySourceLimit?: number } = {}
  ) => {
    const recentLimit = Math.max(1, options.recentLimit ?? 12);
    const summaryTriggerCount = Math.max(1, options.summaryTriggerCount ?? 8);
    const summarySourceLimit = Math.max(1, options.summarySourceLimit ?? 60);
    const objectId = new mongoose.Types.ObjectId(userId);

    const [totalMessages, recentChats, longTermMemory, conversationSummary] = await Promise.all([
      ChatMessage.countDocuments({ userId: objectId }),
      ChatMessage.find({ userId: objectId }).sort({ createdAt: -1 }).limit(recentLimit).lean(),
      aiMemoryService.getLongTermMemory(userId, 12),
      aiMemoryService.getConversationSummary(userId),
    ]);

    const normalizedRecentChats = recentChats.reverse();
    const olderMessagesCount = Math.max(0, totalMessages - normalizedRecentChats.length);
    const shouldRefreshSummary = olderMessagesCount >= summaryTriggerCount;

    let olderMessagesForSummary: Array<{ role: "user" | "ai"; message: string }> = [];
    if (shouldRefreshSummary) {
      const olderRows = await ChatMessage.find({ userId: objectId })
        .sort({ createdAt: -1 })
        .skip(recentLimit)
        .limit(summarySourceLimit)
        .lean();
      olderMessagesForSummary = olderRows.reverse().map((item) => ({
        role: item.role,
        message: item.message,
      }));
    }

    return {
      longTermMemory,
      conversationSummary,
      recentHistory: normalizedRecentChats.map((item) => ({ role: item.role, message: item.message })),
      olderMessagesForSummary,
      shouldRefreshSummary,
      totalMessages,
    };
  },
};
