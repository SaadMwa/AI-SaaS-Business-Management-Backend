import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import {
  askAIOnce,
  askAIStream,
  askAdminEntityWithGemini,
  askAdvisorWithMemory,
  askChatWithMemory,
  buildFallbackResponse,
  interpretIntentWithLLM,
  summarizeConversationHistory,
} from "../services/ai.service";
import { runAgent } from "../services/agent.service";
import { preserveRawInput, RawInputRequest } from "../middlewares/raw-input.middleware";
import { Customer } from "../models/customer";
import { Sale } from "../models/sale";
import { Task } from "../models/task";
import { User } from "../models/user";
import { Product } from "../models/product";
import { taskService } from "../services/task.service";
import { saleService } from "../services/sale.service";
import { customerService } from "../services/customer.service";
import { entityService } from "../services/entity.service";
import { historyService } from "../services/history.service";
import { env } from "../config/env";
import { detectAiIntent } from "../agent-core/intent/aiIntentEngine";
import { detectHistoryIntent } from "../agent-core/intent/historyIntentEngine";
import { classifyIntent } from "../agent-core/intent/intentClassifier";
import { authenticate, requireAdmin, AuthRequest } from "../middlewares/auth.middleware";
import { getAiGuide } from "../controllers/ai-help.controller";
import { aiMemoryService } from "../services/ai-memory.service";
import { adminConversationalAiService } from "../services/admin-conversational-ai.service";
import { logger } from "../utils/logger";
import { levenshteinDistance, normalizeWithDictionary } from "../utils/fuzzy";
import { aiSessionStateService } from "../services/ai-session-state.service";
import { aiRateLimit } from "../middlewares/ai-rate-limit.middleware";
import { adminAiInsightsService } from "../services/admin-ai-insights.service";
import { storeProductAgentService } from "../services/store-product-agent.service";

const router = express.Router();

const VISITOR_SAFE_RESPONSE =
  "I am here to help with products and purchases in this store only.";

const sanitizeText = (value: unknown, max = 2000) => {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max);
};

const isLikelyClarificationRequest = (question: string) => {
  const normalized = question.toLowerCase().trim();
  if (!normalized) return false;
  const tokenCount = normalized.split(/\s+/).filter(Boolean).length;
  if (tokenCount > 3) return false;
  if (/\d/.test(normalized)) return false;
  if (/(in stock|available|price|cost|recommend|best|top|under|over)/i.test(normalized)) {
    return false;
  }
  return normalized.length <= 20;
};

const toObjectId = (value: unknown) => {
  if (typeof value !== "string") return null;
  if (!mongoose.Types.ObjectId.isValid(value)) return null;
  return new mongoose.Types.ObjectId(value);
};

const formatDate = (value?: string | Date | null) => {
  if (!value) return "Unknown date";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toISOString().split("T")[0];
};

const normalizeStatus = (value?: string) => {
  if (!value) return value;
  return value === "in-progress" ? "in_progress" : value;
};

const makeStructuredAnswer = (answer: string, evidence: string[], nextSteps: string[]) => {
  const safeEvidence = evidence.length ? evidence : ["No supporting data available."];
  const safeNext = nextSteps.length ? nextSteps : ["Add more business data for richer insights."];
  return [
    `Answer: ${answer}`,
    "Evidence:",
    ...safeEvidence.map((item) => `- ${item}`),
    "Next steps:",
    ...safeNext.map((item) => `- ${item}`),
  ].join("\n");
};

const autoTagFromText = (text: string) => {
  const lower = text.toLowerCase();
  const tags = new Set<string>();
  const rules: Array<[string, string]> = [
    ["follow up", "follow-up"],
    ["follow-up", "follow-up"],
    ["customer", "customer"],
    ["sale", "sale"],
    ["invoice", "invoice"],
    ["payment", "payment"],
    ["email", "email"],
    ["call", "call"],
    ["meeting", "meeting"],
    ["demo", "demo"],
    ["bug", "bug"],
    ["issue", "issue"],
    ["urgent", "urgent"],
    ["onboarding", "onboarding"],
    ["renewal", "renewal"],
  ];
  rules.forEach(([needle, tag]) => {
    if (lower.includes(needle)) tags.add(tag);
  });
  return Array.from(tags);
};

const parsePriority = (question: string) => {
  if (question.includes("urgent")) return "urgent";
  if (question.includes("high")) return "high";
  if (question.includes("low")) return "low";
  if (question.includes("medium")) return "medium";
  return undefined;
};

const parseDueDate = (question: string) => {
  const isoMatch = question.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];
  const now = new Date();
  if (question.includes("today")) return now.toISOString().split("T")[0];
  if (question.includes("tomorrow")) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  }
  if (question.includes("next week")) {
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    return d.toISOString().split("T")[0];
  }
  if (question.includes("next month")) {
    const d = new Date(now);
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().split("T")[0];
  }
  return undefined;
};

const getTasksData = async (createdByFilter: Record<string, unknown>) => {
  const tasks = await Task.find(createdByFilter)
    .sort({ createdAt: -1 })
    .limit(200)
    .select("title description dueDate status priority tags assignedTo createdAt task_number")
    .populate("assignedTo", "name email")
    .lean()
    .maxTimeMS(10000);

  const now = new Date();
  const dueSoon = new Date();
  dueSoon.setDate(dueSoon.getDate() + 7);

  const tasksByStatus = tasks.reduce(
    (acc, task) => {
      const status = normalizeStatus(task.status) || task.status;
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    },
    { todo: 0, in_progress: 0, blocked: 0, done: 0 } as Record<string, number>
  );

  const overdueTasks = tasks.filter(
    (task) =>
      task.status !== "done" &&
      task.dueDate &&
      new Date(task.dueDate).getTime() < now.getTime()
  ).length;

  const dueSoonTasks = tasks.filter(
    (task) =>
      task.status !== "done" &&
      task.dueDate &&
      new Date(task.dueDate).getTime() >= now.getTime() &&
      new Date(task.dueDate).getTime() <= dueSoon.getTime()
  ).length;

  const highPriorityTasks = tasks.filter(
    (task) => task.status !== "done" && task.priority === "high"
  ).length;

  const urgentTasks = tasks.filter(
    (task) => task.status !== "done" && task.priority === "urgent"
  ).length;

  const unassignedTasks = tasks.filter((task) => !task.assignedTo).length;

  const tagCounts = new Map<string, number>();
  tasks.forEach((task) => {
    (task.tags || []).forEach((tag) => {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    });
  });
  const topTags = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag, count]) => ({ tag, count }));

  const recentTasks = tasks.slice(0, 5);

  return {
    totalTasks: tasks.length,
    tasksByStatus,
    overdueTasks,
    dueSoonTasks,
    highPriorityTasks,
    urgentTasks,
    unassignedTasks,
    topTags,
    recentTasks,
  };
};

const getBusinessData = async (createdByFilter: Record<string, unknown>) => {
  const last30Days = new Date();
  last30Days.setDate(last30Days.getDate() - 30);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const taskSummary = await getTasksData(createdByFilter);
  const totalCustomers = await Customer.countDocuments(createdByFilter).maxTimeMS(10000);

  const lastCustomer = await Customer.findOne(createdByFilter)
    .sort({ createdAt: -1 })
    .select("name email phone createdAt")
    .lean()
    .maxTimeMS(10000);

  const recentCustomers = await Customer.find(createdByFilter)
    .sort({ createdAt: -1 })
    .limit(5)
    .select("name email phone createdAt")
    .lean()
    .maxTimeMS(10000);

  const salesLast30Days = await Sale.countDocuments({
    ...createdByFilter,
    createdAt: { $gte: last30Days },
  }).maxTimeMS(10000);

  const avgOrderValueAgg = await Sale.aggregate([
    { $match: { ...createdByFilter, createdAt: { $gte: last30Days } } },
    { $group: { _id: null, avg: { $avg: "$total" } } },
  ]).option({ maxTimeMS: 10000 });

  const lastSale = await Sale.findOne(createdByFilter)
    .sort({ createdAt: -1 })
    .select("total status createdAt customerId")
    .populate("customerId", "name email")
    .lean()
    .maxTimeMS(10000);

  const recentSales = await Sale.find(createdByFilter)
    .sort({ createdAt: -1 })
    .limit(5)
    .select("total status createdAt customerId")
    .populate("customerId", "name email")
    .lean()
    .maxTimeMS(10000);

  const revenueLast30DaysAgg = await Sale.aggregate([
    { $match: { ...createdByFilter, createdAt: { $gte: last30Days } } },
    { $group: { _id: null, total: { $sum: "$total" } } },
  ]).option({ maxTimeMS: 10000 });

  const monthlyRevenueAgg = await Sale.aggregate([
    { $match: { ...createdByFilter, createdAt: { $gte: monthStart } } },
    { $group: { _id: null, total: { $sum: "$total" } } },
  ]).option({ maxTimeMS: 10000 });

  const topProducts = await Sale.aggregate([
    { $match: { ...createdByFilter, createdAt: { $gte: last30Days } } },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.name",
        quantity: { $sum: "$items.quantity" },
        revenue: { $sum: { $multiply: ["$items.quantity", "$items.price"] } },
      },
    },
    { $sort: { revenue: -1 } },
    { $limit: 5 },
    { $project: { _id: 0, name: "$_id", quantity: 1, revenue: 1 } },
  ]).option({ maxTimeMS: 10000 });

  const topCustomers = await Sale.aggregate([
    { $match: { ...createdByFilter, createdAt: { $gte: last30Days } } },
    {
      $group: {
        _id: "$customerId",
        revenue: { $sum: "$total" },
        orders: { $sum: 1 },
      },
    },
    { $sort: { revenue: -1 } },
    { $limit: 5 },
    {
      $lookup: {
        from: "customers",
        localField: "_id",
        foreignField: "_id",
        as: "customer",
      },
    },
    { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        customerId: "$_id",
        name: "$customer.name",
        email: "$customer.email",
        revenue: 1,
        orders: 1,
      },
    },
  ]).option({ maxTimeMS: 10000 });

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const monthlyRevenueSeries = await Sale.aggregate([
    { $match: { ...createdByFilter, createdAt: { $gte: sixMonthsAgo } } },
    {
      $group: {
        _id: {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
        },
        revenue: { $sum: "$total" },
        sales: { $sum: 1 },
      },
    },
    { $sort: { "_id.year": 1, "_id.month": 1 } },
    {
      $project: {
        _id: 0,
        year: "$_id.year",
        month: "$_id.month",
        revenue: 1,
        sales: 1,
      },
    },
  ]).option({ maxTimeMS: 10000 });

  const uniqueCustomersAgg = await Sale.aggregate([
    { $match: { ...createdByFilter } },
    { $group: { _id: "$customerId" } },
    { $count: "count" },
  ]).option({ maxTimeMS: 10000 });
  const uniqueCustomers = uniqueCustomersAgg[0]?.count || 0;

  const repeatCustomersAgg = await Sale.aggregate([
    { $match: { ...createdByFilter } },
    { $group: { _id: "$customerId", orders: { $sum: 1 } } },
    { $match: { orders: { $gte: 2 } } },
    { $count: "count" },
  ]).option({ maxTimeMS: 10000 });
  const repeatCustomers = repeatCustomersAgg[0]?.count || 0;

  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const recentCustomersAgg = await Sale.aggregate([
    { $match: { ...createdByFilter, createdAt: { $gte: sixtyDaysAgo } } },
    { $group: { _id: "$customerId" } },
    { $count: "count" },
  ]).option({ maxTimeMS: 10000 });
  const customersWithRecentSales = recentCustomersAgg[0]?.count || 0;
  const inactiveCustomers = Math.max(0, totalCustomers - customersWithRecentSales);

  return {
    totalCustomers,
    lastCustomer,
    recentCustomers,
    salesLast30Days,
    avgOrderValue30Days: avgOrderValueAgg[0]?.avg || 0,
    lastSale,
    recentSales,
    revenueLast30Days: revenueLast30DaysAgg[0]?.total || 0,
    monthlyRevenue: monthlyRevenueAgg[0]?.total || 0,
    topProducts,
    topCustomers,
    monthlyRevenueSeries,
    uniqueCustomers,
    repeatCustomers,
    repeatRate: uniqueCustomers ? repeatCustomers / uniqueCustomers : 0,
    inactiveCustomers,
    taskSummary,
  };
};

const resolveActionClarification = (intent: ReturnType<typeof detectAiIntent>) => {
  if (intent.kind !== "action") return null;
  if (["update", "delete", "assign", "unassign"].includes(intent.action || "")) {
    if (!intent.entityNumber || !intent.entityType) {
      return `Which ${intent.entityType || "entity"} number should I use?`;
    }
  }
  if (intent.action === "update" && (!intent.updates || !Object.keys(intent.updates).length)) {
    return "What should I update?";
  }
  if (intent.action === "assign" && intent.entityType === "task" && !intent.updates?.assigneeName && !intent.updates?.assigneeEmail) {
    return "Who should I assign it to?";
  }
  return null;
};

const isDeleteConfirmed = (text: string) => {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("confirm delete") ||
    normalized.includes("yes delete") ||
    normalized.includes("confirmed delete") ||
    normalized.includes("confirm removal")
  );
};

const isConfirmCommand = (text: string) => {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.!?,]+$/g, "");
  return /^(confirm|yes|approve|go ahead|confirm delete|confirm delete history|confirm now|confirmed)$/.test(normalized);
};

const isCancelCommand = (text: string) => /^(cancel|stop|no|abort)$/i.test(text.trim());

const logAiQuery = async (
  userId: string | undefined,
  question: string,
  queryType?: string
) => {
  if (!userId) return;
  try {
    await historyService.logAction({
      userId,
      entityType: "ai",
      action: "query",
      performedBy: "ai",
      meta: { question, queryType },
    });
  } catch (error) {
    logger.warn("history_ai_log_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const parseAuthToken = (authorizationHeader?: string) => {
  const token = authorizationHeader?.startsWith("Bearer ")
    ? authorizationHeader.slice(7)
    : null;
  if (!token) return null;
  if (!env.jwtSecret) return null;

  try {
    const decoded = jwt.verify(token, env.jwtSecret) as {
      userId?: string;
      role?: string;
      store_id?: string;
      full_access?: boolean;
    };
    return {
      userId: decoded.userId,
      role: decoded.role,
      store_id: decoded.store_id,
      full_access: decoded.full_access,
    };
  } catch {
    return null;
  }
};

const INTERNAL_KEYWORDS = [
  "task",
  "tasks",
  "sale",
  "sales",
  "customer",
  "customers",
  "dashboard",
  "insight",
  "profit",
  "revenue",
  "employee",
  "history",
  "internal",
];

const containsKeyword = (text: string, keywords: string[]) =>
  keywords.some((word) => text.includes(word));

type VisitorIntent =
  | "catalog"
  | "availability"
  | "stock"
  | "price"
  | "description"
  | "recommendation"
  | "category"
  | "popular"
  | "unknown";

type VisitorSessionState = {
  history: Array<{ role: "user" | "ai"; message: string }>;
  lastProductIds: string[];
  lastMentionedProductId?: string;
  updatedAt: number;
};

const visitorSessions = new Map<string, VisitorSessionState>();

type VisitorGeminiIntent = {
  intent:
    | "catalog"
    | "availability"
    | "price"
    | "description"
    | "recommendation"
    | "popular"
    | "unrelated";
  product_name?: string | null;
  category?: string | null;
  follow_up?: boolean;
  confidence?: number;
};

const normalizeTokens = (value: string) =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);

const STORE_STOP_TOKENS = new Set([
  "i",
  "need",
  "want",
  "show",
  "list",
  "find",
  "please",
  "have",
  "do",
  "you",
  "any",
  "a",
  "the",
  "item",
  "items",
  "product",
  "products",
]);

const singularizeToken = (token: string) => {
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith("es") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && token.length > 3) return token.slice(0, -1);
  return token;
};

const STORE_SYNONYMS: Record<string, string[]> = {
  watch: ["smartwatch", "smart", "watch", "wearable"],
  smartwatch: ["smartwatch", "smart", "watch", "wearable"],
  shoes: ["shoe", "sneakers", "trainers"],
  shoe: ["shoes", "sneakers", "trainers"],
  sneakers: ["shoe", "shoes", "trainers"],
  phone: ["smartphone", "mobile", "cellphone", "phone"],
  smartphone: ["phone", "mobile", "cellphone", "smartphone"],
  earbuds: ["earbuds", "earphones", "earphones"],
  earphones: ["earbuds", "earphones", "headphones"],
};

const expandStoreQueryTokens = (value: string) => {
  const seed = normalizeTokens(value)
    .map((token) => singularizeToken(token))
    .filter((token) => token.length >= 2 && !STORE_STOP_TOKENS.has(token));
  const expanded = new Set<string>();
  seed.forEach((token) => {
    expanded.add(token);
    const synonyms = STORE_SYNONYMS[token] || [];
    synonyms.forEach((entry) => expanded.add(singularizeToken(entry)));
  });
  return Array.from(expanded);
};

const buildStoreProductTokenSet = (product: { name: string; description?: string; category?: string }) => {
  const base = `${product.name} ${product.description || ""} ${product.category || ""}`;
  return new Set(
    normalizeTokens(base)
      .map((token) => singularizeToken(token))
      .filter((token) => token.length >= 2)
  );
};

const tokenCoverage = (queryTokens: string[], productTokens: Set<string>) => {
  if (!queryTokens.length) return 0;
  let matched = 0;
  for (const token of queryTokens) {
    if (productTokens.has(token)) matched += 1;
  }
  return matched / queryTokens.length;
};

const normalizedSimilarity = (left: string, right: string) => {
  const a = left.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const b = right.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  const dist = levenshteinDistance(a, b);
  return maxLen ? 1 - dist / maxLen : 0;
};

const STORE_SYSTEM_PROMPT = [
  "You are a polite, friendly, and professional store assistant.",
  "You speak in a warm and welcoming tone.",
  "You are helpful, positive, and slightly cheerful but not unprofessional.",
  "You avoid robotic or overly technical replies.",
  "If user greets you, greet warmly.",
  "If user asks for product availability, respond kindly and clearly.",
  "If user says goodbye, respond politely with a warm closing.",
  "If user makes spelling mistakes, understand intent and respond naturally.",
  "Never mention spelling errors.",
  "Never say “As an AI”.",
  "Never say “Confirm again”.",
  "Never sound mechanical.",
  "Keep responses concise but warm.",
].join(" ");

const STORE_TYPO_DICTIONARY: Record<string, string> = {
  availble: "available",
  avaliable: "available",
  availabilty: "availability",
  avaiable: "available",
  thx: "thanks",
  tnx: "thanks",
  pls: "please",
  plz: "please",
  recomned: "recommend",
  reccomend: "recommend",
  recomended: "recommended",
  sugest: "suggest",
  sugested: "suggested",
  cataloge: "catalog",
  prodcts: "products",
  pruducts: "products",
  accesories: "accessories",
};

const normalizeVisitorQuestion = (question: string) => {
  const trimmed = sanitizeText(question);
  const normalized = normalizeWithDictionary(trimmed, STORE_TYPO_DICTIONARY);
  return { trimmed, normalized };
};

const VISITOR_INTENT_KEYWORDS = {
  goodbye: ["bye", "goodbye", "see you", "exit", "thanks bye", "see ya", "later"],
  greeting: ["hi", "hello", "hey", "good morning", "good afternoon", "good evening"],
  thanks: ["thanks", "thank you", "appreciate it", "thx"],
  availability: ["available", "in stock", "out of stock", "availability", "have it", "do you have"],
};

const containsPhrase = (text: string, phrases: string[]) => {
  const normalized = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  return phrases.some((phrase) => normalized.includes(` ${phrase} `));
};

const pickOne = (options: string[]) => options[Math.floor(Math.random() * options.length)];

const buildVisitorClosing = () =>
  pickOne([
    "Thank you for visiting! Hope to see you again soon 😊",
    "You're always welcome! Have a wonderful day!",
    "Thanks for stopping by! Come back anytime!",
  ]);

const getTimeGreetingPrefix = (date = new Date()) => {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
};

const buildVisitorGreeting = () =>
  pickOne([
    `${getTimeGreetingPrefix()}! How can I help you find the right product today?`,
    `${getTimeGreetingPrefix()}! Happy to help with product info, pricing, or availability.`,
    `${getTimeGreetingPrefix()}! What can I help you discover in the store today?`,
  ]);

const buildVisitorThanks = () =>
  pickOne([
    "You're welcome! Let me know if you want any recommendations.",
    "Happy to help! Want me to suggest something similar?",
    "Anytime! I can also check price and availability for you.",
  ]);

const preclassifyVisitorIntent = (question: string): VisitorIntent => {
  const q = question.toLowerCase();
  if (/(top|popular|best.?selling|trending|hot item)/i.test(q)) return "popular";
  if (/(recommend|suggest|similar|best option|best choice)/i.test(q)) return "recommendation";
  if (/(category|in electronics|in accessories|in gadgets)/i.test(q)) return "category";
  if (/(price|cost|how much|under|below|over|above|\$)/i.test(q)) return "price";
  if (/(stock|in stock|available|availability|do you have|have any)/i.test(q)) return "availability";
  if (/(description|details|tell me about|what is|what's)/i.test(q)) return "description";
  if (/(show|list|catalog|products|items|store)/i.test(q)) return "catalog";
  return "unknown";
};

const normalizePlain = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

const extractLikelyProductPhrase = (question: string) => {
  const cleaned = normalizePlain(question)
    .replace(/\b(do you have|have|need|want|show|list|price|cost|how much|for|recommend|similar|available|stock|in|the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned;
};

const RELATED_PRODUCT_KEYWORDS: Record<string, string[]> = {
  laptop: ["tablet", "notebook", "computer"],
  notebook: ["laptop", "tablet", "computer"],
  tablet: ["ipad", "laptop", "notebook"],
  watch: ["smartwatch", "wearable", "fitness"],
  smartwatch: ["watch", "wearable", "fitness"],
  phone: ["smartphone", "mobile", "cellphone"],
  smartphone: ["phone", "mobile", "cellphone"],
  earbuds: ["earphones", "headphones", "audio"],
  headphones: ["earbuds", "earphones", "audio"],
};

const toUnavailablePlural = (value: string) => {
  const v = value.trim().toLowerCase();
  if (!v) return "items";
  if (v.endsWith("s")) return v;
  if (v.endsWith("y") && v.length > 3) return `${v.slice(0, -1)}ies`;
  return `${v}s`;
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const geminiGenerate = async (prompt: string, temperature = 0.2, maxOutputTokens = 700) => {
  if (!env.geminiApiKey) return null;
  const fetchFn = typeof fetch === "function" ? fetch : (await import("node-fetch")).default;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.geminiApiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens },
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
    return text || null;
  } catch (error) {
    logger.warn("gemini_generate_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const parseVisitorIntentWithGemini = async (
  question: string,
  memory: VisitorSessionState
): Promise<VisitorGeminiIntent | null> => {
  const prompt = [
    "You are an intent parser for an e-commerce store assistant.",
    "Return JSON only. No markdown.",
    "JSON shape:",
    '{"intent":"catalog|availability|price|description|recommendation|popular|unrelated","product_name":string|null,"category":"Electronics|Accessories|Gadgets|null","follow_up":boolean,"confidence":number}',
    "Rules:",
    "- intent=unrelated if question is not about store products.",
    "- If user says 'price?' or 'is it in stock?' with no product, set follow_up=true.",
    "- product_name must be the explicit product mention when present.",
    memory.lastMentionedProductId
      ? "There is prior context: user recently discussed a product."
      : "No prior product context.",
    `Question: ${question}`,
  ].join("\n");

  const text = await geminiGenerate(prompt, 0, 250);
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[0]) as VisitorGeminiIntent;
    return parsed;
  } catch {
    return null;
  }
};

const generateVisitorAnswerWithGemini = async (
  question: string,
  intent: VisitorIntent | "unrelated",
  cards: Array<{
    name: string;
    price: number;
    stock_label: string;
    description: string;
    category: string;
  }>,
  memory: VisitorSessionState
) => {
  const history = memory.history.slice(-5).map((entry) => `${entry.role}: ${entry.message}`);
  const prompt = [
    STORE_SYSTEM_PROMPT,
    "You MUST use only the matched products JSON as source of truth.",
    "Do not invent products, prices, stock, or categories not present in JSON.",
    "Respond in 1-3 short sentences.",
    "If user asks unrelated things, respond exactly: I am here to help with products in this store only.",
    "If no product match is found, respond politely and offer similar items.",
    "Keep responses warm and human. Use at most 1 emoji.",
    `Intent: ${intent}`,
    history.length ? `Recent context:\n${history.join("\n")}` : "Recent context: (none)",
    `User question: ${question}`,
    `Matched products: ${JSON.stringify(cards)}`,
  ].join("\n");

  const attempt = async () => geminiGenerate(prompt, 0.5, 220);
  const first = await attempt();
  if (first) return first;
  return await attempt();
};

const inferVisitorIntent = (question: string): VisitorIntent => {
  if (/(top|popular|best.?selling|trending)/i.test(question)) return "popular";
  if (/(recommend|suggest|best for|best product|gift|starter)/i.test(question)) return "recommendation";
  if (/(in stock|out of stock|available|availability|have)/i.test(question)) return "availability";
  if (/(price|cost|cheap|expensive|under|below|over|above|\$)/i.test(question)) return "price";
  if (/(description|details|tell me about|what is|what's)/i.test(question)) return "description";
  if (/(show|list|catalog|products|items|store)/i.test(question)) return "catalog";
  return "unknown";
};

const readSessionState = (sessionId: string): VisitorSessionState => {
  const existing = visitorSessions.get(sessionId);
  const now = Date.now();
  if (existing && now - existing.updatedAt <= 30 * 60 * 1000) {
    existing.updatedAt = now;
    return existing;
  }
  const created: VisitorSessionState = { history: [], lastProductIds: [], updatedAt: now };
  visitorSessions.set(sessionId, created);
  return created;
};

const handleVisitorProductQuestion = async (question: string, storeId: string) => {
  return storeProductAgentService.answer({
    storeId,
    message: question,
  });
};

const resolveVisitorSessionId = (req: RawInputRequest) => {
  const fromBody = typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : "";
  if (fromBody) return fromBody;
  const fromHeader = typeof req.headers["x-session-id"] === "string" ? req.headers["x-session-id"].trim() : "";
  if (fromHeader) return fromHeader;
  const fallback = req.ip || "visitor";
  return `visitor:${fallback}`;
};

const formatVisitorCardsAsText = (cards: Array<{ name: string; price: number; stock_label: string }>) => {
  return cards.map((product) => {
    return `- ${product.name}: $${product.price.toFixed(2)} | ${product.stock_label}`;
  });
};

type AdminEntityType = "task" | "customer" | "sale" | "product";
type AdminCard = {
  type: AdminEntityType;
  id: string;
  title: string;
  subtitle?: string;
  details: Record<string, unknown>;
};

type AdminSessionContext = {
  lastEntityType?: AdminEntityType;
  lastTask?: Record<string, unknown>;
  lastCustomer?: Record<string, unknown>;
  lastSale?: Record<string, unknown>;
  lastProduct?: Record<string, unknown>;
  updatedAt: number;
};
type CachedAiResponse = { expiresAt: number; value: any };
const aiResponseCache = new Map<string, CachedAiResponse>();
const AI_CACHE_TTL_MS = 45 * 1000;

type AdminAiMode = "Analytics" | "Inventory" | "CRM" | "Operations" | "Strategy";
type AiActionMode = "manual" | "direct" | "hybrid";

const detectAdminMode = (message: string, hintedMode?: string): AdminAiMode => {
  const source = `${hintedMode || ""} ${message}`.toLowerCase();
  if (/\banalytics|kpi|revenue|trend|forecast\b/.test(source)) return "Analytics";
  if (/\binventory|stock|reorder|featured|best seller|best-seller\b/.test(source)) return "Inventory";
  if (/\bcrm|customer|retention|churn|account\b/.test(source)) return "CRM";
  if (/\boperations|task|workflow|assign|pending\b/.test(source)) return "Operations";
  if (/\bstrategy|growth|positioning|plan\b/.test(source)) return "Strategy";
  return "Operations";
};

const buildProactiveActions = (mode: AdminAiMode, businessData: any) => {
  if (mode === "Inventory") {
    const lowStock = Number(businessData?.metrics?.lowStockCount || businessData?.lowStockCount || 0);
    return [
      lowStock > 0
        ? `Create reorder tasks for ${lowStock} low-stock products.`
        : "Set a low-stock threshold alert at 5 units for all SKUs.",
      "Review best-seller trends and keep featured products in stock.",
    ];
  }
  if (mode === "Analytics") {
    return [
      "Compare this month revenue against last month and flag >10% drops.",
      "Create a weekly KPI review task for the operations lead.",
    ];
  }
  if (mode === "CRM") {
    return [
      "List top customers by revenue and schedule re-engagement for inactive ones.",
      "Create follow-up tasks for customers without purchases in 60 days.",
    ];
  }
  if (mode === "Strategy") {
    return [
      "Draft a 30-day growth experiment with owner, KPI, and deadline.",
      "Prioritize one revenue lever and one retention lever this week.",
    ];
  }
  return [
    "Review overdue and unassigned tasks, then assign clear owners.",
    "Schedule a daily 10-minute blocker triage.",
  ];
};

const detectActionMode = (value: unknown): AiActionMode => {
  if (typeof value !== "string") return "hybrid";
  const normalized = value.trim().toLowerCase();
  if (normalized === "manual") return "manual";
  if (normalized === "direct") return "direct";
  return "hybrid";
};

const buildCacheKey = (parts: Array<string | number | undefined | null>) =>
  parts
    .map((part) => String(part || ""))
    .join("|")
    .trim();

const readCache = (key: string) => {
  const existing = aiResponseCache.get(key);
  if (!existing) return null;
  if (existing.expiresAt <= Date.now()) {
    aiResponseCache.delete(key);
    return null;
  }
  return existing.value;
};

const writeCache = (key: string, value: any, ttlMs = AI_CACHE_TTL_MS) => {
  aiResponseCache.set(key, { expiresAt: Date.now() + ttlMs, value });
};

const buildManualUiAction = (question: string) => {
  if (/\btask\b/i.test(question)) return { type: "open_form" as const, entityType: "task" as const };
  if (/\bsale\b/i.test(question)) return { type: "open_form" as const, entityType: "sale" as const };
  if (/\bcustomer\b/i.test(question)) return { type: "open_form" as const, entityType: "customer" as const };
  if (/\bproduct\b/i.test(question)) return { type: "open_form" as const, entityType: "product" as const };
  return null;
};

const resolveAdminEntityType = (question: string, session?: AdminSessionContext): AdminEntityType | null => {
  if (/\btask|tasks|status|assigned\b/i.test(question)) return "task";
  if (/\bcustomer|customers|client|purchase\b/i.test(question)) return "customer";
  if (/\bsale|sales|revenue|top.?selling\b/i.test(question)) return "sale";
  if (/\bproduct|products|stock|price\b/i.test(question)) return "product";
  if (/\bits status|who was assigned|show details|details\b/i.test(question)) {
    return session?.lastEntityType || null;
  }
  return null;
};

const extractEntityNumber = (question: string) => {
  const match = question.match(/#?\s*(\d{1,8})\b/);
  return match ? Number(match[1]) : null;
};

const pickTaskProjection = (task: any) => ({
  id: task._id?.toString?.() || String(task._id || ""),
  task_number: task.task_number,
  title: task.title || "",
  description: task.description || "",
  status: task.status || "unknown",
  assigned_user:
    typeof task.assignedTo === "object" && task.assignedTo
      ? `${task.assignedTo.name || "Unknown"}${task.assignedTo.email ? ` (${task.assignedTo.email})` : ""}`
      : "Unassigned",
});

const pickCustomerProjection = (customer: any, recentPurchase: any) => ({
  id: customer._id?.toString?.() || String(customer._id || ""),
  customer_number: customer.customerNumber || customer.customer_number,
  name: customer.name || "",
  email: customer.email || "",
  recent_purchase: recentPurchase
    ? {
        sale_number: recentPurchase.saleNumber || recentPurchase.sale_number,
        total: recentPurchase.total || 0,
        createdAt: recentPurchase.createdAt,
      }
    : null,
});

const pickSaleProjection = (sale: any) => ({
  id: sale._id?.toString?.() || String(sale._id || ""),
  sale_number: sale.saleNumber || sale.sale_number,
  customer_name: typeof sale.customerId === "object" ? sale.customerId?.name : "Unknown",
  total: sale.total || 0,
  status: sale.status || "unknown",
  products: Array.isArray(sale.items)
    ? sale.items.map((item: any) => ({
        product: item.name,
        quantity: item.quantity,
        total_price: Number(item.quantity || 0) * Number(item.price || 0),
      }))
    : [],
});

const pickProductProjection = (product: any) => ({
  id: product._id?.toString?.() || String(product._id || ""),
  name: product.name || "",
  stock: product.stock_quantity || 0,
  price: product.price || 0,
  description: product.description || "",
  image: product.image_url || "",
  category: product.category || "General",
});

const buildTaskCards = (items: ReturnType<typeof pickTaskProjection>[]): AdminCard[] =>
  items.map((item) => ({
    type: "task",
    id: item.id,
    title: `Task #${item.task_number}: ${item.title}`,
    subtitle: String(item.status),
    details: {
      description: item.description,
      assigned_user: item.assigned_user,
      status: item.status,
    },
  }));

const buildCustomerCards = (items: ReturnType<typeof pickCustomerProjection>[]): AdminCard[] =>
  items.map((item) => ({
    type: "customer",
    id: item.id,
    title: `${item.name} (${item.customer_number || "N/A"})`,
    subtitle: item.email || "No email",
    details: {
      recent_purchase: item.recent_purchase,
    },
  }));

const buildSaleCards = (items: ReturnType<typeof pickSaleProjection>[]): AdminCard[] =>
  items.map((item) => ({
    type: "sale",
    id: item.id,
    title: `Sale #${item.sale_number || "N/A"}`,
    subtitle: `${item.status} - $${Number(item.total || 0).toFixed(2)}`,
    details: {
      customer: item.customer_name,
      products: item.products,
      total_price: item.total,
    },
  }));

const buildProductCards = (items: ReturnType<typeof pickProductProjection>[]): AdminCard[] =>
  items.map((item) => ({
    type: "product",
    id: item.id,
    title: item.name,
    subtitle: `$${Number(item.price || 0).toFixed(2)} - Stock ${item.stock}`,
    details: {
      stock: item.stock,
      price: item.price,
      description: item.description,
      image: item.image,
      category: item.category,
    },
  }));

const updateAdminSession = async (
  userId: string,
  key: string,
  entityType: AdminEntityType,
  firstRecord: Record<string, unknown> | undefined
) => {
  const previous = await aiSessionStateService.getAdminSession(userId, key);
  const next: AdminSessionContext = { ...previous, lastEntityType: entityType, updatedAt: Date.now() };
  if (entityType === "task" && firstRecord) next.lastTask = firstRecord;
  if (entityType === "customer" && firstRecord) next.lastCustomer = firstRecord;
  if (entityType === "sale" && firstRecord) next.lastSale = firstRecord;
  if (entityType === "product" && firstRecord) next.lastProduct = firstRecord;
  await aiSessionStateService.saveAdminSession(userId, key, next);
  return next;
};

const handleAdminEntityQuery = async (params: {
  userId: string;
  question: string;
  normalizedQuestion: string;
  createdByFilter: Record<string, unknown>;
  storeId: string;
  sessionKey: string;
  adminMode: AdminAiMode;
}) => {
  const session = await aiSessionStateService.getAdminSession(params.userId, params.sessionKey);
  const entityType = resolveAdminEntityType(params.question, session);
  if (!entityType) return null;

  const entityNumber = extractEntityNumber(params.question);
  const wantsStatus = /\bstatus\b/i.test(params.question);
  const wantsAssigned = /\bwho was assigned|assigned\b/i.test(params.question);
  const wantsDetails = /\bshow details|details\b/i.test(params.question);
  const limit = wantsDetails ? 5 : 10;

  let records: Record<string, unknown>[] = [];
  let cards: AdminCard[] = [];

  if (entityType === "task") {
    if ((wantsStatus || wantsAssigned || wantsDetails) && session?.lastTask) {
      records = [session.lastTask];
    } else {
      const tasks = await Task.find(
        entityNumber ? { ...params.createdByFilter, task_number: entityNumber } : params.createdByFilter
      )
        .sort({ createdAt: -1 })
        .limit(limit)
        .select("task_number title description status assignedTo createdAt")
        .populate("assignedTo", "name email")
        .lean()
        .maxTimeMS(10000);
      records = tasks.map((task) => pickTaskProjection(task));
    }
    cards = buildTaskCards(records as ReturnType<typeof pickTaskProjection>[]);
  }

  if (entityType === "customer") {
    const customers = await Customer.find(
      entityNumber
        ? { ...params.createdByFilter, $or: [{ customerNumber: entityNumber }, { customer_number: String(entityNumber) }] }
        : params.createdByFilter
    )
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("customerNumber customer_number name email createdAt")
      .lean()
      .maxTimeMS(10000);

    const recordsWithPurchases = await Promise.all(
      customers.map(async (customer) => {
        const recentPurchase = await Sale.findOne({
          ...params.createdByFilter,
          customerId: customer._id,
        })
          .sort({ createdAt: -1 })
          .select("saleNumber sale_number total createdAt")
          .lean()
          .maxTimeMS(10000);
        return pickCustomerProjection(customer, recentPurchase);
      })
    );
    records = recordsWithPurchases;
    cards = buildCustomerCards(recordsWithPurchases);
  }

  if (entityType === "sale") {
    const wantsSalesStats = /\btop.?selling|revenue|product stats?\b/i.test(params.question);
    if (wantsSalesStats) {
      const last30Days = new Date();
      last30Days.setDate(last30Days.getDate() - 30);
      const revenueAgg = await Sale.aggregate([
        { $match: { ...params.createdByFilter, createdAt: { $gte: last30Days } } },
        { $group: { _id: null, revenue: { $sum: "$total" }, totalSales: { $sum: 1 } } },
      ]).option({ maxTimeMS: 10000 });
      const topProducts = await Sale.aggregate([
        { $match: { ...params.createdByFilter, createdAt: { $gte: last30Days } } },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.name",
            quantity: { $sum: "$items.quantity" },
            revenue: { $sum: { $multiply: ["$items.quantity", "$items.price"] } },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 5 },
        { $project: { _id: 0, product: "$_id", quantity: 1, revenue: 1 } },
      ]).option({ maxTimeMS: 10000 });
      const summaryRecord = {
        id: "sale-stats",
        sale_number: "summary",
        customer_name: "All customers",
        total: revenueAgg[0]?.revenue || 0,
        status: "summary",
        products: topProducts.map((item) => ({
          product: item.product,
          quantity: item.quantity,
          total_price: item.revenue,
        })),
      };
      records = [summaryRecord];
      cards = buildSaleCards([summaryRecord as ReturnType<typeof pickSaleProjection>]);
    }

    if (!records.length) {
    const sales = await Sale.find(
      entityNumber
        ? { ...params.createdByFilter, $or: [{ saleNumber: entityNumber }, { sale_number: String(entityNumber) }] }
        : params.createdByFilter
    )
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("saleNumber sale_number customerId items total status createdAt")
      .populate("customerId", "name email")
      .lean()
      .maxTimeMS(10000);

    records = sales.map((sale) => pickSaleProjection(sale));
    cards = buildSaleCards(records as ReturnType<typeof pickSaleProjection>[]);
    }
  }

  if (entityType === "product") {
    const nameMatch = params.question.match(/product\s+(.+)/i);
    const productFilter = nameMatch
      ? {
          store_id: params.storeId,
          name: { $regex: String(nameMatch[1]).trim(), $options: "i" },
        }
      : { store_id: params.storeId };

    const products = await Product.find(productFilter)
      .sort({ top_selling: -1, popularity_score: -1, createdAt: -1 })
      .limit(limit)
      .select("name stock_quantity price description image_url category")
      .lean()
      .maxTimeMS(10000);

    records = products.map((product) => pickProductProjection(product));
    cards = buildProductCards(records as ReturnType<typeof pickProductProjection>[]);
  }

  const firstRecord = records[0];
  const nextSession = await updateAdminSession(params.userId, params.sessionKey, entityType, firstRecord);

  const memoryHint = `last_entity=${nextSession.lastEntityType || "none"}`;
  const answer = await askAdminEntityWithGemini({
    question: params.question,
    entityType,
    records,
    memoryHint,
    modeHint: params.adminMode,
  });

  return { answer, cards, entityType, records };
};

router.post(
  "/ask",
  aiRateLimit({
    shouldCount: (req) => {
      const q = sanitizeText((req.body as any)?.question, 200).toLowerCase();
      if (isConfirmCommand(q) || isCancelCommand(q)) return false;
      if (isLikelyClarificationRequest(q)) return false;
      return true;
    },
  }),
  preserveRawInput,
  async (req: RawInputRequest, res) => {
  logger.debug("ai_request_incoming", { path: req.path });
  try {
    const { question: rawQuestion, userId, sessionId } = req.body ?? {};
    const question = sanitizeText(rawQuestion, 4000);
    const rawText = sanitizeText(req.rawText || rawQuestion, 4000);

    if (!question) {
      logger.warn("ai_missing_question");
      return res.status(400).json({ error: "Question required" });
    }
    
    const rawNormalizedQuestion = normalizeWithDictionary(rawText || question, {
      creat: "create",
      tsk: "task",
      updte: "update",
      prduct: "product",
      stcok: "stock",
      avalable: "available",
      assgin: "assign",
      unasign: "unassign",
    })
      .trim()
      .toLowerCase();
    const declaredMode =
      typeof req.body?.adminMode === "string" ? sanitizeText(req.body.adminMode, 40) : "";
    const businessAdvisorMode = Boolean(req.body?.businessAdvisorMode);
    const actionMode = detectActionMode(req.body?.aiActionMode);
    const strippedQuestion = question.replace(
      /^\s*(mode\s*:?\s*(analytics|inventory|crm|operations|strategy)\s*:?)\s*/i,
      ""
    );
    const strippedRaw = rawText.replace(
      /^\s*(mode\s*:?\s*(analytics|inventory|crm|operations|strategy)\s*:?)\s*/i,
      ""
    );
    const effectiveQuestion = strippedQuestion || question;
    const effectiveRawText = strippedRaw || rawText || question;
    const normalizedQuestion = normalizeWithDictionary(effectiveRawText, {
      creat: "create",
      tsk: "task",
      updte: "update",
      prduct: "product",
      stcok: "stock",
      avalable: "available",
      assgin: "assign",
      unasign: "unassign",
    })
      .trim()
      .toLowerCase();
    const authContext = parseAuthToken(req.headers.authorization);
    const isAdminUser = authContext?.role === "admin";
    const storeId = authContext?.store_id || env.demoStoreId;
    const isGreeting =
      rawNormalizedQuestion.length <= 15 &&
      ["hi", "hello", "hey", "yo", "sup", "good morning", "good afternoon", "good evening"].some(
        (greeting) => rawNormalizedQuestion.includes(greeting)
      );

    if (!isAdminUser && isGreeting) {
      return res.json({
        answer: buildVisitorGreeting(),
        businessData: null,
        mode: "CHAT",
      });
    }

    if (isAdminUser && isGreeting) {
      return res.json({
        answer:
          businessAdvisorMode
            ? "Business Advisor Mode is on. Ask for KPI commentary, growth plans, or action priorities."
            : "Admin access is enabled. Ask about tasks, customers, sales, products, or follow-up details.",
        businessData: null,
        mode: "CHAT",
        full_access: true,
      });
    }

    if (mongoose.connection.readyState !== 1) {
      logger.error("ai_db_not_connected", { state: mongoose.connection.readyState });
      return res.status(503).json({
        error: "Database not connected",
        details: "MongoDB connection is not ready. Start MongoDB and restart the backend.",
      });
    }

    if (!isAdminUser) {
      const visitorSessionId = resolveVisitorSessionId(req);
      const visitorCacheKey = buildCacheKey([
        "visitor-product-query",
        visitorSessionId,
        storeId,
        normalizedQuestion,
      ]);
      const cachedVisitor = readCache(visitorCacheKey);
      if (cachedVisitor) {
        return res.json(cachedVisitor);
      }
      const visitorResult = await handleVisitorProductQuestion(normalizedQuestion, storeId);
      const visitorPayload = {
        answer: visitorResult.message,
        message: visitorResult.message,
        businessData: null,
        mode: "CHAT",
        products: visitorResult.products,
        found: visitorResult.found,
        intent: visitorResult.intent,
        search_term: visitorResult.search_term,
        product_id: visitorResult.product_id,
        can_add_to_cart: visitorResult.can_add_to_cart,
        sessionId: visitorSessionId,
      };
      writeCache(visitorCacheKey, visitorPayload);
      return res.json(visitorPayload);
    }

    const adminMode = businessAdvisorMode
      ? "Strategy"
      : detectAdminMode(normalizedQuestion, declaredMode);
    const aiIntent = detectAiIntent(normalizedQuestion);
    const historyIntent = detectHistoryIntent(normalizedQuestion);
    const mode = classifyIntent(normalizedQuestion);

    let mockUserId = toObjectId(authContext?.userId || userId);

    if (!mockUserId && authContext?.userId) {
      mockUserId = toObjectId(authContext.userId);
    }

    if (!mockUserId) {
    logger.debug("ai_userid_missing_infer");
      const sampleCustomer = await Customer.findOne().select("createdBy").lean();
      const sampleSale = !sampleCustomer
        ? await Sale.findOne().select("createdBy").lean()
        : null;
      const foundId = sampleCustomer?.createdBy || sampleSale?.createdBy;
      if (foundId) {
        mockUserId =
          foundId instanceof mongoose.Types.ObjectId
            ? foundId
            : new mongoose.Types.ObjectId(foundId as string);
      }
    }

    const createdByFilter = mockUserId ? { createdBy: mockUserId } : {};
    logger.debug("ai_created_by_filter", { createdByFilter });
    const resolvedSessionId = typeof sessionId === "string" ? sessionId : "default";
    const adminSessionKey = `${mockUserId?.toString() || "admin"}:${resolvedSessionId}`;

    const useStream = req.query.stream === "true";

    if (mockUserId) {
      await aiMemoryService.saveChatMessage(mockUserId.toString(), "user", question);
      await aiMemoryService.extractAndStoreLongTermMemory(mockUserId.toString(), question);

      const sessionState = await aiSessionStateService.getAdminSession(
        mockUserId.toString(),
        adminSessionKey
      );
      if (sessionState.pendingAction) {
        if (isCancelCommand(effectiveQuestion)) {
          await aiSessionStateService.clearPendingAction(mockUserId.toString(), adminSessionKey);
          return res.json({
            answer: "Pending action cancelled.",
            businessData: null,
            mode: "ACTION",
            actionMode,
            adminMode,
          });
        }

        if (isConfirmCommand(effectiveQuestion)) {
          const pending = sessionState.pendingAction;
          await aiSessionStateService.clearPendingAction(mockUserId.toString(), adminSessionKey);

          if (pending.type === "history_delete") {
            const filters = (pending.payload?.filters || {}) as Parameters<
              typeof historyService.deleteHistory
            >[1];
            const result = await historyService.deleteHistory(mockUserId.toString(), filters);
            return res.json({
              answer: `Deleted ${result.deletedCount} history entries.`,
              businessData: { deleted: result.deletedCount },
              mode: "ACTION",
              actionMode,
              adminMode,
            });
          }

          if (pending.type === "delete") {
            const entityType = String(pending.payload?.entityType || "");
            const entityNumber = Number(pending.payload?.entityNumber || 0);
            if (!entityType || !entityNumber || !["task", "customer", "sale"].includes(entityType)) {
              return res.status(400).json({
                error: "Pending action is invalid or expired. Please retry the delete command.",
              });
            }
            if (entityType === "task") {
              await taskService.deleteTaskByNumber(mockUserId.toString(), entityNumber, "ai");
            } else if (entityType === "customer") {
              await customerService.deleteCustomerByNumber(mockUserId.toString(), entityNumber, "ai");
            } else {
              await saleService.deleteSaleByNumber(mockUserId.toString(), entityNumber, "ai");
            }
            return res.json({
              answer: `Deleted ${entityType} #${entityNumber}.`,
              businessData: { entityType, entityNumber },
              mode: "ACTION",
              actionMode,
              adminMode,
            });
          }
        }
      }
    }

    if (
      actionMode === "manual" &&
      aiIntent.kind === "action" &&
      (aiIntent.action === "create" || aiIntent.action === "update")
    ) {
      const manual = buildManualUiAction(effectiveQuestion);
      if (manual) {
        return res.json({
          answer: `Opening ${manual.entityType} form. Fill fields and submit.`,
          cards: [],
          uiAction: { ...manual, mode: aiIntent.action === "update" ? "update" : "create" },
          businessData: null,
          mode: "ACTION",
          adminMode,
          actionMode,
          agent: { role: "admin", mode: adminMode, actionMode },
        });
      }
    }

    if (mockUserId && actionMode !== "direct") {
      const conversational = await adminConversationalAiService.handleMessage({
        userId: mockUserId.toString(),
        sessionId: typeof sessionId === "string" ? sessionId : undefined,
        message: effectiveQuestion,
        storeId,
      });
      if (conversational?.handled) {
        await aiMemoryService.saveChatMessage(mockUserId.toString(), "ai", conversational.answer);
        await logAiQuery(mockUserId.toString(), effectiveQuestion, "conversational_flow");
        return res.json({
          answer: conversational.answer,
          cards: conversational.cards || [],
          uiAction: conversational.uiAction || null,
          businessData: {
            conversation: {
              flow: conversational.state.flow,
              pendingFields: conversational.state.pendingFields,
              lastFieldFilled: conversational.state.lastFieldFilled,
              lastEntity: conversational.state.lastEntity || null,
            },
          },
          mode: "ACTION",
          actionMode,
          adminMode,
          proactiveActions:
            conversational.proactiveActions && conversational.proactiveActions.length
              ? conversational.proactiveActions
              : buildProactiveActions(adminMode, null),
          agent: { role: "admin", mode: adminMode, actionMode },
          full_access: true,
          sessionId: typeof sessionId === "string" ? sessionId : "default",
        });
      }
    }

    const actionVerbs = /\b(create|add|update|edit|delete|remove|assign|unassign)\b/i;
    if (!actionVerbs.test(normalizedQuestion)) {
      try {
        const cacheKey = buildCacheKey([
          "admin-query",
          mockUserId?.toString(),
          normalizedQuestion,
          adminMode,
          storeId,
        ]);
        const cached = readCache(cacheKey);
        if (cached) {
          return res.json(cached);
        }
        const adminQueryResult = await handleAdminEntityQuery({
          userId: mockUserId?.toString() || "",
          question: effectiveQuestion,
          normalizedQuestion,
          createdByFilter,
          storeId,
          sessionKey: adminSessionKey,
          adminMode,
        });
        if (adminQueryResult) {
          if (mockUserId) {
            await aiMemoryService.saveChatMessage(mockUserId.toString(), "ai", adminQueryResult.answer);
          }
          await logAiQuery(mockUserId?.toString(), effectiveQuestion, `admin_${adminQueryResult.entityType}_query`);
          const responsePayload = {
            answer: adminQueryResult.answer,
            cards: adminQueryResult.cards,
            businessData: { entityType: adminQueryResult.entityType, records: adminQueryResult.records },
            mode: "ACTION",
            actionMode,
            adminMode,
            proactiveActions: buildProactiveActions(adminMode, null),
            agent: { role: "admin", mode: adminMode, actionMode },
            full_access: true,
            sessionId: adminSessionKey,
          };
          if (adminQueryResult.entityType === "product") {
            writeCache(cacheKey, responsePayload);
          }
          return res.json(responsePayload);
        }
      } catch (error) {
        logger.warn("ai_admin_entity_fallback", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (mode === "CHAT" && adminMode !== "Analytics" && adminMode !== "Strategy") {
      try {
        const context = mockUserId
          ? await aiMemoryService.buildChatContext(mockUserId.toString(), {
              recentLimit: 12,
              summaryTriggerCount: 10,
              summarySourceLimit: 80,
            })
          : {
              longTermMemory: [],
              conversationSummary: null,
              recentHistory: [],
              olderMessagesForSummary: [],
              shouldRefreshSummary: false,
            };

        let conversationSummary = context.conversationSummary;
        if (mockUserId && context.shouldRefreshSummary && context.olderMessagesForSummary.length) {
          const refreshedSummary = await summarizeConversationHistory(
            context.olderMessagesForSummary,
            context.conversationSummary
          );
          if (refreshedSummary) {
            await aiMemoryService.upsertConversationSummary(mockUserId.toString(), refreshedSummary);
            conversationSummary = refreshedSummary;
          }
        }

        const answer = await askChatWithMemory(
          effectiveQuestion,
          context.longTermMemory,
          conversationSummary,
          context.recentHistory
        );
        if (mockUserId) {
          await aiMemoryService.saveChatMessage(mockUserId.toString(), "ai", answer);
        }
        await logAiQuery(mockUserId?.toString(), effectiveQuestion, "chat");
        return res.json({
          answer,
          businessData: null,
          mode: "CHAT",
          actionMode,
          adminMode,
          proactiveActions: buildProactiveActions(adminMode, null),
          agent: { role: "admin", mode: adminMode, actionMode },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "AI is unavailable";
        if (message.startsWith("GEMINI_QUOTA_EXCEEDED")) {
          const retryAfter = message.split(":")[1] || "60";
          return res.json({
            answer: `AI is temporarily rate limited. Please retry in about ${retryAfter} seconds.`,
            businessData: null,
            mode: "CHAT",
            rateLimited: true,
          });
        }
        return res.status(500).json({ error: "AI failed", details: message });
      }
    }

    if (mode === "BUSINESS_ADVICE" || adminMode === "Analytics" || adminMode === "Strategy") {
      try {
        const businessData = await getBusinessData(createdByFilter);
        const context = mockUserId
          ? await aiMemoryService.buildChatContext(mockUserId.toString(), {
              recentLimit: 12,
              summaryTriggerCount: 10,
              summarySourceLimit: 80,
            })
          : {
              longTermMemory: [],
              conversationSummary: null,
              recentHistory: [],
              olderMessagesForSummary: [],
              shouldRefreshSummary: false,
            };

        let conversationSummary = context.conversationSummary;
        if (mockUserId && context.shouldRefreshSummary && context.olderMessagesForSummary.length) {
          const refreshedSummary = await summarizeConversationHistory(
            context.olderMessagesForSummary,
            context.conversationSummary
          );
          if (refreshedSummary) {
            await aiMemoryService.upsertConversationSummary(mockUserId.toString(), refreshedSummary);
            conversationSummary = refreshedSummary;
          }
        }

        const answer = await askAdvisorWithMemory(
          effectiveQuestion,
          businessData,
          context.longTermMemory,
          conversationSummary,
          context.recentHistory
        );
        if (mockUserId) {
          await aiMemoryService.saveChatMessage(mockUserId.toString(), "ai", answer);
        }
        await logAiQuery(mockUserId?.toString(), effectiveQuestion, "business_advice");
        return res.json({
          answer,
          businessData,
          mode: "BUSINESS_ADVICE",
          actionMode,
          adminMode,
          proactiveActions: buildProactiveActions(adminMode, businessData),
          agent: { role: "admin", mode: adminMode, actionMode },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "AI is unavailable";
        if (message.startsWith("GEMINI_QUOTA_EXCEEDED")) {
          const retryAfter = message.split(":")[1] || "60";
          return res.json({
            answer: `AI is temporarily rate limited. Please retry in about ${retryAfter} seconds.`,
            businessData: null,
            mode: "BUSINESS_ADVICE",
            rateLimited: true,
          });
        }
        return res.status(500).json({ error: "AI failed", details: message });
      }
    }

    if (historyIntent.kind !== "unknown") {
      if (!mockUserId) {
        return res.status(400).json({
          error: "User context required to manage history.",
          details: "Provide userId when managing history via AI.",
        });
      }

      if (historyIntent.kind === "delete" && !historyIntent.confirmed) {
        const filterSummary = [
          historyIntent.filters.entityType ? `entity=${historyIntent.filters.entityType}` : null,
          historyIntent.filters.entityId ? `id=#${historyIntent.filters.entityId}` : null,
          historyIntent.filters.olderThanDays
            ? `olderThan=${historyIntent.filters.olderThanDays} days`
            : null,
        ]
          .filter(Boolean)
          .join(", ");

        await aiSessionStateService.savePendingAction(
          mockUserId.toString(),
          adminSessionKey,
          {
            type: "history_delete",
            payload: { filters: historyIntent.filters },
          }
        );

        return res.json({
          answer: `This will delete history${filterSummary ? ` (${filterSummary})` : ""}. Reply with "confirm delete history" to proceed.`,
          businessData: null,
          mode: "ACTION",
          requiresConfirmation: {
            type: "history_delete",
            prompt: "confirm delete history",
          },
        });
      }

      if (historyIntent.kind === "delete") {
        const result = await historyService.deleteHistory(mockUserId.toString(), historyIntent.filters);
        await historyService.logAction({
          userId: mockUserId.toString(),
          entityType: "ai",
          action: "delete_history",
          performedBy: "ai",
          meta: { filters: historyIntent.filters, deleted: result.deletedCount },
        });
        return res.json({
          answer: makeStructuredAnswer(
            `Deleted ${result.deletedCount} history entries.`,
            [`deleted=${result.deletedCount}`],
            ["Use filters to narrow deletion scope next time."]
          ),
          businessData: { deleted: result.deletedCount },
          mode: "ACTION",
        });
      }

      const history = await historyService.getHistory(mockUserId.toString(), historyIntent.filters);
      await historyService.logAction({
        userId: mockUserId.toString(),
        entityType: "ai",
        action: "view_history",
        performedBy: "ai",
        meta: { filters: historyIntent.filters, count: history.length },
      });
      const preview = history.slice(0, 5).map((entry) => ({
        entityType: entry.entityType,
        entityId: entry.entityId || entry.entityNumber,
        action: entry.actionType || entry.action,
        performedBy: entry.performedBy,
        createdAt: entry.createdAt,
      }));
      return res.json({
        answer: makeStructuredAnswer(
          history.length ? `Found ${history.length} history entries.` : "No history entries found.",
          [`entries_found=${history.length}`],
          ["Apply filters like entity type or date range to refine results."]
        ),
        businessData: { history, preview },
        mode: "ACTION",
      });
    }

    if (aiIntent.kind === "action" && aiIntent.action === "delete" && !isDeleteConfirmed(rawText || question)) {
      if (!mockUserId) {
        return res.status(400).json({
          error: "User context required to delete records.",
          details: "Provide a valid user session and retry.",
        });
      }
      if (!aiIntent.entityType || !aiIntent.entityNumber) {
        return res.json({
          answer: "Which record should I delete? Please provide entity type and number (example: delete task #12).",
          businessData: null,
          mode: "ACTION",
        });
      }
      await aiSessionStateService.savePendingAction(mockUserId.toString(), adminSessionKey, {
        type: "delete",
        payload: {
          entityType: aiIntent.entityType,
          entityNumber: aiIntent.entityNumber,
        },
      });
      return res.json({
        answer: `This will delete ${aiIntent.entityType} #${aiIntent.entityNumber}. Reply with "confirm delete" to proceed.`,
        businessData: null,
        mode: "ACTION",
        requiresConfirmation: {
          type: "delete",
          prompt: "confirm delete",
        },
      });
    }

    if (aiIntent.kind === "action" && mockUserId && (aiIntent.action === "update" || aiIntent.action === "unassign")) {
      if (aiIntent.entityType === "product") {
        return res.json({
          answer: "For products, I will open the product update form so you can validate fields safely.",
          uiAction: { type: "open_form", entityType: "product", mode: "update" },
          businessData: null,
          mode: "ACTION",
        });
      }
      let updates = aiIntent.updates || {};
      let entityNumber = aiIntent.entityNumber;
      if (aiIntent.action === "unassign") {
        updates = { ...updates, assignedTo: null };
      }
      updates = { ...updates, _performedBy: "ai" };

      if (!Object.keys(updates).length || !entityNumber) {
        try {
          const llmIntent = await interpretIntentWithLLM(rawText);
          if (llmIntent?.entities?.updates && Object.keys(llmIntent.entities.updates).length) {
            updates = { ...updates, ...llmIntent.entities.updates };
          }
          if (!entityNumber) {
            entityNumber =
              llmIntent?.entities?.taskNumber ||
              llmIntent?.entities?.customerNumber ||
              llmIntent?.entities?.saleNumber ||
              entityNumber;
          }
        } catch (error) {
          // Ignore LLM parse failures, fall through to clarification.
        }
      }

      const clarification = resolveActionClarification({
        ...aiIntent,
        entityNumber,
        updates,
      });
      if (clarification) {
        return res.json({ answer: clarification, businessData: null, mode: "ACTION" });
      }

      try {
        const updated = await entityService.updateEntity(
          mockUserId.toString(),
          aiIntent.entityType!,
          entityNumber!,
          updates
        );
        const postActionInsight = await adminAiInsightsService.buildPostActionInsight(
          mockUserId.toString(),
          aiIntent.entityType as "task" | "sale" | "customer" | "product",
          `Updated ${aiIntent.entityType} #${entityNumber}.`
        );
        // action handled; log via history service in entity updates
        return res.json({
          answer: postActionInsight,
          businessData: { entityType: aiIntent.entityType, entityNumber, entity: updated },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Update failed";
        if (message.includes("not found")) {
          return res.status(404).json({ error: message });
        }
        return res.status(400).json({ error: message });
      }
    }

    const agentResponse = await runAgent({
      question: effectiveQuestion,
      rawText: effectiveRawText,
      userId: mockUserId?.toString(),
      sessionId: typeof sessionId === "string" ? sessionId : undefined,
      performedBy: "ai",
    });

    if (agentResponse.handled) {
      if (!useStream) {
        if (mockUserId) {
          await aiMemoryService.saveChatMessage(
            mockUserId.toString(),
            "ai",
            agentResponse.answer || ""
          );
        }
        const actionInsight = mockUserId
          ? await adminAiInsightsService.buildDashboardNarrative(mockUserId.toString())
          : null;
        return res.json({
          answer: [agentResponse.answer, actionInsight ? `Advisor note: ${actionInsight}` : ""]
            .filter(Boolean)
            .join("\n"),
          businessData: agentResponse.businessData ?? null,
          mode: "ACTION",
        });
      }

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("Transfer-Encoding", "chunked");
      res.flushHeaders();
      res.write(" ");
      if (mockUserId) {
        await aiMemoryService.saveChatMessage(
          mockUserId.toString(),
          "ai",
          agentResponse.answer || ""
        );
      }
      res.write(agentResponse.answer || "");
      res.end();
      return;
    }

    const last30Days = new Date();
    last30Days.setDate(last30Days.getDate() - 30);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const isCreateTask =
      aiIntent.kind === "action" &&
      aiIntent.action === "create" &&
      aiIntent.entityType === "task";

    if (isCreateTask) {
      if (!mockUserId) {
        return res.status(400).json({
          error: "User context required to create tasks.",
          details: "Provide userId when creating tasks via AI.",
        });
      }

      const createMatch = rawText.match(/\b(create|add|new)\s+(a\s+)?task\s+(.+)/i);
      const title = createMatch && createMatch[3] ? createMatch[3].trim() : rawText;
      if (!title) {
        return res.status(400).json({ error: "Task title is required." });
      }

      const priority = parsePriority(normalizedQuestion);
      const dueDate = parseDueDate(normalizedQuestion);

      const emailMatch = question.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      const assignedUser = emailMatch
        ? await User.findOne({ email: emailMatch[0] }).select("_id").lean()
        : null;

      const tags = autoTagFromText(title);

      const task = await taskService.createTask(mockUserId.toString(), {
        title,
        raw_input: rawText,
        description: "",
        priority: priority || "medium",
        dueDate,
        assignedTo: assignedUser?._id?.toString(),
        tags,
        meta: {
          ai_interpretation: { priority, dueDate, assignedUser: assignedUser?._id },
          raw_text: rawText,
        },
        _performedBy: "ai",
      });

      return res.json({
        answer: makeStructuredAnswer(
          `Created task "${task.title}" with priority ${task.priority}.`,
          [
            `task_number=${task.task_number}`,
            `assigned_to=${assignedUser ? assignedUser._id.toString() : "unassigned"}`,
            `due_date=${dueDate || "none"}`,
            `tags=${JSON.stringify(tags)}`,
          ],
          ["Review the task details and adjust priority or due date if needed."]
        ),
        businessData: { createdTask: task },
      });
    }

    if (aiIntent.kind === "query" && aiIntent.queryType === "taskAutoTag") {
      if (!mockUserId) {
        return res.status(400).json({
          error: "User context required to tag tasks.",
          details: "Provide userId when tagging tasks via AI.",
        });
      }

      const tasks = await Task.find(createdByFilter)
        .select("title description tags")
        .lean()
        .maxTimeMS(10000);

      let updated = 0;
      for (const task of tasks) {
        if (task.tags && task.tags.length) continue;
        const tags = autoTagFromText([task.title, task.description].filter(Boolean).join(" "));
        if (tags.length) {
          await Task.updateOne({ _id: task._id }, { $set: { tags } }).maxTimeMS(10000);
          updated += 1;
        }
      }

      return res.json({
        answer: makeStructuredAnswer(
          `Auto-tagged ${updated} tasks.`,
          [`tasks_updated=${updated}`, `total_tasks=${tasks.length}`],
          ["Create tasks with clear descriptions for better tagging results."]
        ),
        businessData: { tasksUpdated: updated, totalTasks: tasks.length },
      });
    }

    if (aiIntent.kind === "query" && aiIntent.queryType === "recentTasks") {
      const taskSummary = await getTasksData(createdByFilter);
      const recentTasks = taskSummary.recentTasks || [];
      const answer = recentTasks.length
        ? `Here are your ${recentTasks.length} most recent tasks.`
        : "I couldn't find any tasks yet.";
      await logAiQuery(mockUserId?.toString(), question, aiIntent.queryType);
      return res.json({
        answer: makeStructuredAnswer(
          answer,
          [
            `recent_tasks=${JSON.stringify(
              recentTasks.map((task) => ({
                taskNumber: task.task_number,
                title: task.title,
                status: task.status,
                priority: task.priority,
                dueDate: task.dueDate,
              }))
            )}`,
          ],
          ["Add more tasks to get better insights."]
        ),
        businessData: { recentTasks },
      });
    }

    if (aiIntent.kind === "query" && (aiIntent.queryType === "taskSummary" || aiIntent.queryType === "taskSuggestions")) {
      const taskSummary = await getTasksData(createdByFilter);

      if (aiIntent.kind === "query" && aiIntent.queryType === "taskSummary") {
        await logAiQuery(mockUserId?.toString(), question, aiIntent.queryType);
        return res.json({
          answer: makeStructuredAnswer(
            `You have ${taskSummary.totalTasks} tasks. ${taskSummary.overdueTasks} overdue and ${taskSummary.dueSoonTasks} due soon.`,
            [
              `tasks_total=${taskSummary.totalTasks}`,
              `tasks_by_status=${JSON.stringify(taskSummary.tasksByStatus)}`,
              `overdue_tasks=${taskSummary.overdueTasks}`,
              `due_soon_tasks=${taskSummary.dueSoonTasks}`,
            ],
            ["Tackle overdue tasks first.", "Assign owners to unassigned tasks."]
          ),
          businessData: { taskSummary },
        });
      }

      const suggestions = [];
      if (taskSummary.overdueTasks) suggestions.push("Address overdue tasks today.");
      if (taskSummary.urgentTasks || taskSummary.highPriorityTasks)
        suggestions.push("Prioritize urgent and high priority tasks.");
      if (taskSummary.unassignedTasks) suggestions.push("Assign owners to unassigned tasks.");
      if (!suggestions.length) suggestions.push("Keep progressing tasks toward done.");

      await logAiQuery(mockUserId?.toString(), question, aiIntent.queryType);
      return res.json({
        answer: makeStructuredAnswer(
          "Here are suggested next actions for your task board.",
          [
            `overdue_tasks=${taskSummary.overdueTasks}`,
            `urgent_tasks=${taskSummary.urgentTasks}`,
            `unassigned_tasks=${taskSummary.unassignedTasks}`,
          ],
          suggestions
        ),
        businessData: { taskSummary },
      });
    }

    // Handle specific intents
    if (aiIntent.kind === "query" && aiIntent.queryType === "lastCustomer") {
      const lastCustomer = await Customer.findOne(createdByFilter)
        .sort({ createdAt: -1 })
        .select("name email phone createdAt")
        .lean()
        .maxTimeMS(10000);

      const answer = lastCustomer
        ? `Your most recent customer is ${lastCustomer.name || "Unnamed"} (${lastCustomer.email || "no email"}) on ${formatDate(
            lastCustomer.createdAt
          )}.`
        : "I couldn't find any customers yet.";

      await logAiQuery(mockUserId?.toString(), question, aiIntent.queryType);
      return res.json({
        answer: makeStructuredAnswer(
          answer,
          [
            lastCustomer
              ? `last_customer=${JSON.stringify(lastCustomer)}`
              : "last_customer=null",
          ],
          ["Add more customers to get better insights."]
        ),
        businessData: { lastCustomer },
      });
    }

    if (aiIntent.kind === "query" && aiIntent.queryType === "recentCustomers") {
      const recentCustomers = await Customer.find(createdByFilter)
        .sort({ createdAt: -1 })
        .limit(5)
        .select("name email phone createdAt")
        .lean()
        .maxTimeMS(10000);

      const answer = recentCustomers.length
        ? `Here are your ${recentCustomers.length} most recent customers.`
        : "I couldn't find any customers yet.";

      await logAiQuery(mockUserId?.toString(), question, aiIntent.queryType);
      return res.json({
        answer: makeStructuredAnswer(
          answer,
          [`recent_customers=${JSON.stringify(recentCustomers)}`],
          ["Add more customers to get better insights."]
        ),
        businessData: { recentCustomers },
      });
    }

    if (aiIntent.kind === "query" && aiIntent.queryType === "totalCustomers") {
      const totalCustomers = await Customer.countDocuments(createdByFilter).maxTimeMS(10000);
      await logAiQuery(mockUserId?.toString(), question, aiIntent.queryType);
      return res.json({
        answer: makeStructuredAnswer(
          `You currently have ${totalCustomers} customers.`,
          [`customers=${totalCustomers}`],
          ["Track new signups weekly to monitor growth."]
        ),
        businessData: { totalCustomers },
      });
    }

    if (aiIntent.kind === "query" && aiIntent.queryType === "lastSale") {
      const lastSale = await Sale.findOne(createdByFilter)
        .sort({ createdAt: -1 })
        .select("total status createdAt customerId")
        .populate("customerId", "name email")
        .lean()
        .maxTimeMS(10000);

      const answer = lastSale
        ? `Your most recent sale was $${(lastSale.total as number)?.toFixed?.(2) ?? lastSale.total} on ${formatDate(
            lastSale.createdAt
          )}.`
        : "I couldn't find any sales yet.";

      await logAiQuery(mockUserId?.toString(), question, aiIntent.queryType);
      return res.json({
        answer: makeStructuredAnswer(
          answer,
          [lastSale ? `last_sale=${JSON.stringify(lastSale)}` : "last_sale=null"],
          ["Review the latest sale for follow-up opportunities."]
        ),
        businessData: { lastSale },
      });
    }

    if (aiIntent.kind === "query" && aiIntent.queryType === "recentSales") {
      const recentSales = await Sale.find(createdByFilter)
        .sort({ createdAt: -1 })
        .limit(5)
        .select("total status createdAt customerId")
        .populate("customerId", "name email")
        .lean()
        .maxTimeMS(10000);

      const answer = recentSales.length
        ? `Here are your ${recentSales.length} most recent sales.`
        : "I couldn't find any sales yet.";

      await logAiQuery(mockUserId?.toString(), question, aiIntent.queryType);
      return res.json({
        answer: makeStructuredAnswer(
          answer,
          [`recent_sales=${JSON.stringify(recentSales)}`],
          ["Review recent sales to spot quick follow-ups."]
        ),
        businessData: { recentSales },
      });
    }

    if (aiIntent.kind === "query" && aiIntent.queryType === "salesSummary") {
      const salesLast30Days = await Sale.countDocuments({
        ...createdByFilter,
        createdAt: { $gte: last30Days },
      }).maxTimeMS(10000);

      const revenueLast30DaysAgg = await Sale.aggregate([
        { $match: { ...createdByFilter, createdAt: { $gte: last30Days } } },
        { $group: { _id: null, total: { $sum: "$total" } } },
      ]).option({ maxTimeMS: 10000 });
      const revenueLast30Days = revenueLast30DaysAgg[0]?.total || 0;

      const avgOrderValueAgg = await Sale.aggregate([
        { $match: { ...createdByFilter, createdAt: { $gte: last30Days } } },
        { $group: { _id: null, avg: { $avg: "$total" } } },
      ]).option({ maxTimeMS: 10000 });
      const avgOrderValue = avgOrderValueAgg[0]?.avg || 0;

      const lastSale = await Sale.findOne(createdByFilter)
        .sort({ createdAt: -1 })
        .select("total status createdAt customerId saleNumber sale_number")
        .populate("customerId", "name email customerNumber customer_number")
        .lean()
        .maxTimeMS(10000);

      const lastSaleLabel = lastSale
        ? `Most recent sale was $${(lastSale.total as number)?.toFixed?.(2) ?? lastSale.total} on ${formatDate(
            lastSale.createdAt
          )}.`
        : "No recent sales found.";

      await logAiQuery(mockUserId?.toString(), question, aiIntent.queryType);
      return res.json({
        answer: makeStructuredAnswer(
          `Last 30 days: ${salesLast30Days} sales, $${revenueLast30Days} revenue, avg order $${avgOrderValue.toFixed(2)}. ${lastSaleLabel}`,
          [
            `sales_30d=${salesLast30Days}`,
            `revenue_30d=${revenueLast30Days}`,
            `avg_order_value_30d=${avgOrderValue.toFixed(2)}`,
            lastSale ? `last_sale=${JSON.stringify(lastSale)}` : "last_sale=null",
          ],
          ["Review recent sales to identify upsell opportunities."]
        ),
        businessData: { salesLast30Days, revenueLast30Days, avgOrderValue30Days: avgOrderValue, lastSale },
      });
    }

    if (aiIntent.kind === "query" && aiIntent.queryType === "revenueLast30Days") {
      const revenueLast30DaysAgg = await Sale.aggregate([
        { $match: { ...createdByFilter, createdAt: { $gte: last30Days } } },
        { $group: { _id: null, total: { $sum: "$total" } } },
      ]).option({ maxTimeMS: 10000 });
      const revenueLast30Days = revenueLast30DaysAgg[0]?.total || 0;

      await logAiQuery(mockUserId?.toString(), question, aiIntent.queryType);
      return res.json({
        answer: makeStructuredAnswer(
          `Revenue in the last 30 days is $${revenueLast30Days}.`,
          [`revenue_30d=${revenueLast30Days}`],
          ["Compare this to the previous 30 days to measure growth."]
        ),
        businessData: { revenueLast30Days },
      });
    }

    if (aiIntent.kind === "query" && aiIntent.queryType === "salesLast30Days") {
      const salesLast30Days = await Sale.countDocuments({
        ...createdByFilter,
        createdAt: { $gte: last30Days },
      }).maxTimeMS(10000);

      await logAiQuery(mockUserId?.toString(), question, aiIntent.queryType);
      return res.json({
        answer: makeStructuredAnswer(
          `You had ${salesLast30Days} sales in the last 30 days.`,
          [`sales_30d=${salesLast30Days}`],
          ["Review your pipeline to keep momentum going."]
        ),
        businessData: { salesLast30Days },
      });
    }

    if (aiIntent.kind === "query" && aiIntent.queryType === "monthlyRevenue") {
      const monthlyRevenueAgg = await Sale.aggregate([
        { $match: { ...createdByFilter, createdAt: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: "$total" } } },
      ]).option({ maxTimeMS: 10000 });
      const monthlyRevenue = monthlyRevenueAgg[0]?.total || 0;

      await logAiQuery(mockUserId?.toString(), question, aiIntent.queryType);
      return res.json({
        answer: makeStructuredAnswer(
          `Revenue this month is $${monthlyRevenue}.`,
          [`monthly_revenue=${monthlyRevenue}`],
          ["Track weekly progress toward your monthly goal."]
        ),
        businessData: { monthlyRevenue },
      });
    }

    if (aiIntent.kind === "query" && aiIntent.queryType === "topProducts") {
      const topProducts = await Sale.aggregate([
        { $match: { ...createdByFilter, createdAt: { $gte: last30Days } } },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.name",
            quantity: { $sum: "$items.quantity" },
            revenue: { $sum: { $multiply: ["$items.quantity", "$items.price"] } },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 5 },
        { $project: { _id: 0, name: "$_id", quantity: 1, revenue: 1 } },
      ]).option({ maxTimeMS: 10000 });

      await logAiQuery(mockUserId?.toString(), question, aiIntent.queryType);
      return res.json({
        answer: makeStructuredAnswer(
          topProducts.length ? "Your top products are listed below." : "No product data yet.",
          [`top_products=${JSON.stringify(topProducts)}`],
          ["Promote your top products to maximize revenue."]
        ),
        businessData: { topProducts },
      });
    }

    if (aiIntent.kind === "query" && aiIntent.queryType === "topCustomers") {
      const topCustomers = await Sale.aggregate([
        { $match: { ...createdByFilter, createdAt: { $gte: last30Days } } },
        {
          $group: {
            _id: "$customerId",
            revenue: { $sum: "$total" },
            orders: { $sum: 1 },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: "customers",
            localField: "_id",
            foreignField: "_id",
            as: "customer",
          },
        },
        { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            customerId: "$_id",
            name: "$customer.name",
            email: "$customer.email",
            revenue: 1,
            orders: 1,
          },
        },
      ]).option({ maxTimeMS: 10000 });

      await logAiQuery(mockUserId?.toString(), question, aiIntent.queryType);
      return res.json({
        answer: makeStructuredAnswer(
          topCustomers.length ? "Your top customers are listed below." : "No customer revenue data.",
          [`top_customers=${JSON.stringify(topCustomers)}`],
          ["Reach out to top customers with retention offers."]
        ),
        businessData: { topCustomers },
      });
    }

    if (aiIntent.kind === "query" && aiIntent.queryType === "avgOrderValue30Days") {
      const avgOrderValueAgg = await Sale.aggregate([
        { $match: { ...createdByFilter, createdAt: { $gte: last30Days } } },
        { $group: { _id: null, avg: { $avg: "$total" } } },
      ]).option({ maxTimeMS: 10000 });
      const avgOrderValue = avgOrderValueAgg[0]?.avg || 0;

      await logAiQuery(mockUserId?.toString(), question, aiIntent.queryType);
      return res.json({
        answer: makeStructuredAnswer(
          `Average order value over the last 30 days is $${avgOrderValue.toFixed(2)}.`,
          [`avg_order_value_30d=${avgOrderValue.toFixed(2)}`],
          ["Test bundles or upsells to raise average order value."]
        ),
        businessData: { avgOrderValue30Days: avgOrderValue },
      });
    }

    if (aiIntent.kind === "query" && aiIntent.queryType === "monthlyRevenueSeries") {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
      sixMonthsAgo.setDate(1);
      sixMonthsAgo.setHours(0, 0, 0, 0);

      const monthlyRevenueSeries = await Sale.aggregate([
        { $match: { ...createdByFilter, createdAt: { $gte: sixMonthsAgo } } },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
            },
            revenue: { $sum: "$total" },
            sales: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
        {
          $project: {
            _id: 0,
            year: "$_id.year",
            month: "$_id.month",
            revenue: 1,
            sales: 1,
          },
        },
      ]).option({ maxTimeMS: 10000 });

      await logAiQuery(mockUserId?.toString(), question, aiIntent.queryType);
      return res.json({
        answer: makeStructuredAnswer(
          monthlyRevenueSeries.length ? "Here is your 6-month revenue trend." : "No revenue trend data.",
          [`monthly_revenue_series=${JSON.stringify(monthlyRevenueSeries)}`],
          ["Use the trend to forecast next month's targets."]
        ),
        businessData: { monthlyRevenueSeries },
      });
    }

    if (aiIntent.kind === "query" && (aiIntent.queryType === "repeatRate" || aiIntent.queryType === "inactiveCustomers")) {
      const totalCustomers = await Customer.countDocuments(createdByFilter).maxTimeMS(10000);
      const uniqueCustomersAgg = await Sale.aggregate([
        { $match: { ...createdByFilter } },
        { $group: { _id: "$customerId" } },
        { $count: "count" },
      ]).option({ maxTimeMS: 10000 });
      const uniqueCustomers = uniqueCustomersAgg[0]?.count || 0;

      const repeatCustomersAgg = await Sale.aggregate([
        { $match: { ...createdByFilter } },
        { $group: { _id: "$customerId", orders: { $sum: 1 } } },
        { $match: { orders: { $gte: 2 } } },
        { $count: "count" },
      ]).option({ maxTimeMS: 10000 });
      const repeatCustomers = repeatCustomersAgg[0]?.count || 0;
      const repeatRate = uniqueCustomers ? repeatCustomers / uniqueCustomers : 0;

      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

      const recentCustomersAgg = await Sale.aggregate([
        { $match: { ...createdByFilter, createdAt: { $gte: sixtyDaysAgo } } },
        { $group: { _id: "$customerId" } },
        { $count: "count" },
      ]).option({ maxTimeMS: 10000 });
      const customersWithRecentSales = recentCustomersAgg[0]?.count || 0;
      const inactiveCustomers = Math.max(0, totalCustomers - customersWithRecentSales);

      if (aiIntent.kind === "query" && aiIntent.queryType === "repeatRate") {
        await logAiQuery(mockUserId?.toString(), question, aiIntent.queryType);
        return res.json({
          answer: makeStructuredAnswer(
            `Your repeat customer rate is ${(repeatRate * 100).toFixed(1)}%.`,
            [
              `repeat_customers=${repeatCustomers}`,
              `unique_customers=${uniqueCustomers}`,
            ],
            ["Launch a re-engagement campaign to lift repeat rate."]
          ),
          businessData: { repeatRate, repeatCustomers, uniqueCustomers },
        });
      }

      await logAiQuery(mockUserId?.toString(), question, aiIntent.queryType);
      return res.json({
        answer: makeStructuredAnswer(
          `You have ${inactiveCustomers} inactive customers.`,
          [`inactive_customers=${inactiveCustomers}`],
          ["Send a win-back offer to inactive customers."]
        ),
        businessData: { inactiveCustomers },
      });
    }

    // For non-specific intents, gather all business data
    const taskSummary = await getTasksData(createdByFilter);
    const totalCustomers = await Customer.countDocuments(createdByFilter).maxTimeMS(10000);
    logger.debug("ai_total_customers", { totalCustomers });

    const lastCustomer = await Customer.findOne(createdByFilter)
      .sort({ createdAt: -1 })
      .select("name email phone createdAt")
      .lean()
      .maxTimeMS(10000);

    const recentCustomers = await Customer.find(createdByFilter)
      .sort({ createdAt: -1 })
      .limit(5)
      .select("name email phone createdAt")
      .lean()
      .maxTimeMS(10000);

    const salesLast30Days = await Sale.countDocuments({
      ...createdByFilter,
      createdAt: { $gte: last30Days },
    }).maxTimeMS(10000);
    logger.debug("ai_sales_last_30_days", { salesLast30Days });

    const avgOrderValueAgg = await Sale.aggregate([
      { $match: { ...createdByFilter, createdAt: { $gte: last30Days } } },
      { $group: { _id: null, avg: { $avg: "$total" } } },
    ]).option({ maxTimeMS: 10000 });

    const lastSale = await Sale.findOne(createdByFilter)
      .sort({ createdAt: -1 })
      .select("total status createdAt customerId")
      .populate("customerId", "name email")
      .lean()
      .maxTimeMS(10000);

    const recentSales = await Sale.find(createdByFilter)
      .sort({ createdAt: -1 })
      .limit(5)
      .select("total status createdAt customerId")
      .populate("customerId", "name email")
      .lean()
      .maxTimeMS(10000);

    const revenueLast30DaysAgg = await Sale.aggregate([
      { $match: { ...createdByFilter, createdAt: { $gte: last30Days } } },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]).option({ maxTimeMS: 10000 });
    logger.debug("ai_revenue_last_30_days", { revenueLast30DaysAgg });

    const monthlyRevenueAgg = await Sale.aggregate([
      { $match: { ...createdByFilter, createdAt: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]).option({ maxTimeMS: 10000 });
    logger.debug("ai_monthly_revenue", { monthlyRevenueAgg });

    const topProducts = await Sale.aggregate([
      { $match: { ...createdByFilter, createdAt: { $gte: last30Days } } },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.name",
          quantity: { $sum: "$items.quantity" },
          revenue: { $sum: { $multiply: ["$items.quantity", "$items.price"] } },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
      { $project: { _id: 0, name: "$_id", quantity: 1, revenue: 1 } },
    ]).option({ maxTimeMS: 10000 });
    logger.debug("ai_top_products", { count: topProducts.length });

    const topCustomers = await Sale.aggregate([
      { $match: { ...createdByFilter, createdAt: { $gte: last30Days } } },
      {
        $group: {
          _id: "$customerId",
          revenue: { $sum: "$total" },
          orders: { $sum: 1 },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "customers",
          localField: "_id",
          foreignField: "_id",
          as: "customer",
        },
      },
      { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          customerId: "$_id",
          name: "$customer.name",
          email: "$customer.email",
          revenue: 1,
          orders: 1,
        },
      },
    ]).option({ maxTimeMS: 10000 });

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const monthlyRevenueSeries = await Sale.aggregate([
      { $match: { ...createdByFilter, createdAt: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          revenue: { $sum: "$total" },
          sales: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
      {
        $project: {
          _id: 0,
          year: "$_id.year",
          month: "$_id.month",
          revenue: 1,
          sales: 1,
        },
      },
    ]).option({ maxTimeMS: 10000 });

    const uniqueCustomersAgg = await Sale.aggregate([
      { $match: { ...createdByFilter } },
      { $group: { _id: "$customerId" } },
      { $count: "count" },
    ]).option({ maxTimeMS: 10000 });
    const uniqueCustomers = uniqueCustomersAgg[0]?.count || 0;

    const repeatCustomersAgg = await Sale.aggregate([
      { $match: { ...createdByFilter } },
      { $group: { _id: "$customerId", orders: { $sum: 1 } } },
      { $match: { orders: { $gte: 2 } } },
      { $count: "count" },
    ]).option({ maxTimeMS: 10000 });
    const repeatCustomers = repeatCustomersAgg[0]?.count || 0;

    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const recentCustomersAgg = await Sale.aggregate([
      { $match: { ...createdByFilter, createdAt: { $gte: sixtyDaysAgo } } },
      { $group: { _id: "$customerId" } },
      { $count: "count" },
    ]).option({ maxTimeMS: 10000 });
    const customersWithRecentSales = recentCustomersAgg[0]?.count || 0;
    const inactiveCustomers = Math.max(0, totalCustomers - customersWithRecentSales);

    const businessData = {
      totalCustomers,
      lastCustomer,
      recentCustomers,
      salesLast30Days,
      avgOrderValue30Days: avgOrderValueAgg[0]?.avg || 0,
      lastSale,
      recentSales,
      revenueLast30Days: revenueLast30DaysAgg[0]?.total || 0,
      monthlyRevenue: monthlyRevenueAgg[0]?.total || 0,
      topProducts,
      topCustomers,
      monthlyRevenueSeries,
      uniqueCustomers,
      repeatCustomers,
      repeatRate: uniqueCustomers ? repeatCustomers / uniqueCustomers : 0,
      inactiveCustomers,
      taskSummary,
    };

    if (!useStream) {
  

        try {
          const answer = await askAIOnce(effectiveQuestion, businessData as any, 60000);
          if (mockUserId) {
            await aiMemoryService.saveChatMessage(mockUserId.toString(), "ai", answer);
          }
          return res.json({ answer, businessData, mode: "ACTION" });
        } catch (error) {
          logger.error("ai_nonstream_failed", {
            error: error instanceof Error ? error.message : String(error),
          });
          return res.json({ 
            answer: buildFallbackResponse(effectiveQuestion, businessData as any), 
            businessData,
            mode: "ACTION",
          });
        }
    }

 
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Transfer-Encoding", "chunked");
    res.flushHeaders();
    res.write(" "); // open the stream immediately to avoid buffering

    let sentAny = false;
    const fallbackAnswer = buildFallbackResponse(effectiveQuestion, businessData as any);
    const timeout = setTimeout(() => {
      if (!sentAny) {
        logger.warn("ai_stream_timeout");
        if (mockUserId) {
          void aiMemoryService.saveChatMessage(mockUserId.toString(), "ai", fallbackAnswer);
        }
        res.write(fallbackAnswer);
        sentAny = true;
      }
      res.end();
    }, 120000);

    const firstTokenTimeout = setTimeout(() => {
      if (!sentAny) {
        logger.warn("ai_stream_no_tokens");
        if (mockUserId) {
          void aiMemoryService.saveChatMessage(mockUserId.toString(), "ai", fallbackAnswer);
        }
        res.write(fallbackAnswer);
        sentAny = true;
        res.end();
      }
    }, 30000);

    req.on("close", () => {
      clearTimeout(timeout);
      clearTimeout(firstTokenTimeout);
    });

    try {
      await askAIStream(effectiveQuestion, businessData as any, (token) => {
        if (token) {
          sentAny = true;
          clearTimeout(firstTokenTimeout);
          res.write(token);
        }
      });
      clearTimeout(timeout);
      clearTimeout(firstTokenTimeout);
      res.end();
    } catch (error) {
      logger.error("ai_stream_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      if (!sentAny) {
        if (mockUserId) {
          await aiMemoryService.saveChatMessage(mockUserId.toString(), "ai", fallbackAnswer);
        }
        res.write(fallbackAnswer);
      }
      clearTimeout(timeout);
      clearTimeout(firstTokenTimeout);
      res.end();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("ai_error", { message, error: err instanceof Error ? err.message : String(err) });
    if (message.startsWith("GEMINI_QUOTA_EXCEEDED")) {
      const retryAfter = message.split(":")[1] || "60";
      return res.status(200).json({
        answer: `AI is temporarily rate limited. Please retry in about ${retryAfter} seconds.`,
        businessData: null,
        mode: "ACTION",
        rateLimited: true,
      });
    }
    return res.status(500).json({ error: "AI failed", details: message });
  }
  }
);

router.post("/interactive-submit", authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const storeId = req.user?.store_id || env.demoStoreId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { entityType, mode = "create", payload = {} } = req.body || {};
    if (!entityType || !["task", "sale", "customer", "product"].includes(entityType)) {
      return res.status(400).json({ success: false, message: "Invalid entity type" });
    }

    if (entityType === "task") {
      const statusMap: Record<string, string> = {
        pending: "todo",
        todo: "todo",
        "in progress": "in_progress",
        in_progress: "in_progress",
        completed: "done",
        done: "done",
        blocked: "blocked",
      };
      if (mode === "create") {
        if (!payload.title || !String(payload.title).trim()) {
          return res.status(400).json({ success: false, message: "Title is required" });
        }
        const created = await taskService.createTask(userId, {
          title: String(payload.title).trim(),
          description: String(payload.description || "").trim(),
          assignedTo: payload.assignedTo || undefined,
          status: statusMap[String(payload.status || "pending").toLowerCase()] || "todo",
          _performedBy: "ai",
        });
        const assignedLabel =
          typeof created.assignedTo === "object" && created.assignedTo
            ? `${(created.assignedTo as any).name || "Unknown"} (${(created.assignedTo as any).email || ""})`
            : "Unassigned";
        const answer = await adminAiInsightsService.buildPostActionInsight(
          userId,
          "task",
          `Task created: ${created.title}`
        );

        return res.json({
          success: true,
          answer,
          cards: [
            {
              type: "task",
              id: created._id.toString(),
              title: `Task #${created.task_number}: ${created.title}`,
              subtitle: created.status,
              details: {
                title: created.title,
                description: created.description || "",
                assignedTo: assignedLabel,
                status: created.status,
              },
            },
          ],
          entity: created,
        });
      }

      const taskNumber = Number(payload.task_number || payload.taskNumber);
      if (!Number.isFinite(taskNumber)) {
        return res.status(400).json({ success: false, message: "task_number is required for update" });
      }
      const updated = await taskService.updateTaskByNumber(userId, taskNumber, {
        title: payload.title,
        description: payload.description,
        assignedTo: payload.assignedTo,
        status: statusMap[String(payload.status || "pending").toLowerCase()] || undefined,
        _performedBy: "ai",
      });
      const assignedLabel =
        typeof updated.assignedTo === "object" && updated.assignedTo
          ? `${(updated.assignedTo as any).name || "Unknown"} (${(updated.assignedTo as any).email || ""})`
          : "Unassigned";
      return res.json({
        success: true,
        answer: await adminAiInsightsService.buildPostActionInsight(
          userId,
          "task",
          `Task updated: #${taskNumber}`
        ),
        cards: [
          {
            type: "task",
            id: updated._id.toString(),
            title: `Task #${updated.task_number}: ${updated.title}`,
            subtitle: updated.status,
            details: {
              title: updated.title,
              description: updated.description || "",
              assignedTo: assignedLabel,
              status: updated.status,
            },
          },
        ],
        entity: updated,
      });
    }

    if (entityType === "sale") {
      const quantity = Number(payload.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return res.status(400).json({ success: false, message: "Quantity must be greater than 0" });
      }

      const product = payload.productId
        ? await Product.findOne({ _id: payload.productId, store_id: storeId }).lean()
        : await Product.findOne({
            store_id: storeId,
            name: { $regex: String(payload.productName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" },
          })
            .sort({ createdAt: -1 })
            .lean();

      if (!product) {
        return res.status(404).json({ success: false, message: "Product not found" });
      }
      if (product.stock_quantity < quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock. Available: ${product.stock_quantity}`,
        });
      }

      const existingCustomer = await Customer.findOne({ createdBy: new mongoose.Types.ObjectId(userId) })
        .sort({ createdAt: -1 })
        .select("_id")
        .lean();
      const customerId =
        existingCustomer?._id?.toString() ||
        (
          await Customer.create({
            name: "Walk-in Customer",
            email: "walkin@example.com",
            phone: "",
            address: "",
            createdBy: new mongoose.Types.ObjectId(userId),
          })
        )._id.toString();

      if (mode === "update") {
        const saleNumber = Number(payload.sale_number || payload.saleNumber);
        if (!Number.isFinite(saleNumber)) {
          return res.status(400).json({ success: false, message: "sale_number is required for update" });
        }
        const updated = await saleService.updateSaleByNumber(userId, saleNumber, {
          items: [{ name: product.name, quantity, price: product.price }],
          _performedBy: "ai",
        });
        return res.json({
          success: true,
          answer: await adminAiInsightsService.buildPostActionInsight(
            userId,
            "sale",
            `Sale updated: #${saleNumber}`
          ),
          cards: [
            {
              type: "sale",
              id: updated._id.toString(),
              title: `Sale #${updated.saleNumber || updated.sale_number}`,
              subtitle: `$${Number(updated.total || 0).toFixed(2)}`,
              details: {
                product: product.name,
                quantity,
                total_price: updated.total,
                status: updated.status,
              },
            },
          ],
          entity: updated,
        });
      }

      const created = await saleService.createSale(userId, {
        customerId,
        items: [{ name: product.name, quantity, price: product.price }],
        status: "pending",
        paymentMethod: "other",
        _performedBy: "ai",
      });

      await Product.updateOne(
        { _id: product._id, stock_quantity: { $gte: quantity } },
        { $inc: { stock_quantity: -quantity } }
      ).maxTimeMS(10000);

      const answer = await adminAiInsightsService.buildPostActionInsight(
        userId,
        "sale",
        `Sale created: ${product.name} x${quantity}`
      );

      return res.json({
        success: true,
        answer,
        cards: [
          {
            type: "sale",
            id: created._id.toString(),
            title: `Sale #${created.saleNumber || created.sale_number}`,
            subtitle: `$${Number(created.total || 0).toFixed(2)}`,
            details: {
              product: product.name,
              quantity,
              total_price: created.total,
              status: created.status,
            },
          },
        ],
        entity: created,
      });
    }

    if (entityType === "customer") {
      if (!payload.name || !String(payload.name).trim()) {
        return res.status(400).json({ success: false, message: "Name is required" });
      }
      if (mode === "update") {
        const customerNumber = Number(payload.customer_number || payload.customerNumber);
        if (!Number.isFinite(customerNumber)) {
          return res.status(400).json({ success: false, message: "customer_number is required for update" });
        }
        const updated = await customerService.updateCustomerByNumber(userId, customerNumber, {
          name: String(payload.name).trim(),
          email: String(payload.email || "").trim() || undefined,
          phone: String(payload.phone || "").trim() || undefined,
          address: String(payload.address || "").trim() || undefined,
          _performedBy: "ai",
        });
        return res.json({
          success: true,
          answer: await adminAiInsightsService.buildPostActionInsight(
            userId,
            "customer",
            `Customer updated: #${customerNumber}`
          ),
          cards: [
            {
              type: "customer",
              id: updated._id.toString(),
              title: updated.name,
              subtitle: updated.email || "No email",
              details: {
                name: updated.name,
                email: updated.email || "",
                phone: updated.phone || "",
              },
            },
          ],
          entity: updated,
        });
      }

      const created = await customerService.createCustomer(userId, {
        name: String(payload.name).trim(),
        email: String(payload.email || "").trim() || undefined,
        phone: String(payload.phone || "").trim() || undefined,
        address: String(payload.address || "").trim() || undefined,
        _performedBy: "ai",
      });

      const assignedTasks = Array.isArray(payload.assignedTasks) ? payload.assignedTasks : [];
      for (const taskNumber of assignedTasks) {
        const parsed = Number(taskNumber);
        if (!Number.isFinite(parsed)) continue;
        try {
          await taskService.updateTaskByNumber(userId, parsed, {
            relatedToType: "customer",
            relatedToId: created._id.toString(),
            _performedBy: "ai",
          });
        } catch {
          // Ignore individual task assignment failures.
        }
      }

      const answer = await adminAiInsightsService.buildPostActionInsight(
        userId,
        "customer",
        `Customer created: ${created.name}`
      );

      return res.json({
        success: true,
        answer,
        cards: [
          {
            type: "customer",
            id: created._id.toString(),
            title: created.name,
            subtitle: created.email || "No email",
            details: {
              name: created.name,
              email: created.email || "",
              phone: created.phone || "",
              assignedTasks,
            },
          },
        ],
        entity: created,
      });
    }

    if (entityType === "product") {
      const price = Number(payload.price);
      const stock_quantity = Number(payload.stock_quantity);
      if (!payload.name || !String(payload.name).trim()) {
        return res.status(400).json({ success: false, message: "Name is required" });
      }
      if (!payload.description || !String(payload.description).trim()) {
        return res.status(400).json({ success: false, message: "Description is required" });
      }
      if (!Number.isFinite(price) || price < 0) {
        return res.status(400).json({ success: false, message: "Price must be a valid number" });
      }
      if (!Number.isFinite(stock_quantity) || stock_quantity < 0) {
        return res.status(400).json({ success: false, message: "Stock must be a valid number" });
      }
      if (!payload.image_url || !/^https?:\/\/\S+/i.test(String(payload.image_url))) {
        return res.status(400).json({ success: false, message: "Image URL must be valid" });
      }

      if (mode === "update" && payload.id) {
        const updated = await Product.findOneAndUpdate(
          { _id: payload.id, store_id: storeId },
          {
            name: String(payload.name).trim(),
            description: String(payload.description).trim(),
            price,
            stock_quantity,
            category: String(payload.category || "General").trim() || "General",
            image_url: String(payload.image_url).trim(),
          },
          { new: true }
        ).lean();
        if (!updated) return res.status(404).json({ success: false, message: "Product not found" });
        const answer = await adminAiInsightsService.buildPostActionInsight(
          userId,
          "product",
          `Product updated: ${updated.name}`
        );
        return res.json({
          success: true,
          answer,
          cards: [
            {
              type: "product",
              id: updated._id.toString(),
              title: updated.name,
              subtitle: `$${Number(updated.price).toFixed(2)} - Stock ${updated.stock_quantity}`,
              details: {
                name: updated.name,
                description: updated.description,
                price: updated.price,
                stock: updated.stock_quantity,
                category: updated.category,
                image: updated.image_url,
              },
            },
          ],
          entity: updated,
        });
      }

      const created = await Product.create({
        name: String(payload.name).trim(),
        description: String(payload.description).trim(),
        price,
        stock_quantity,
        category: String(payload.category || "General").trim() || "General",
        image_url: String(payload.image_url).trim(),
        store_id: storeId,
        createdBy: new mongoose.Types.ObjectId(userId),
      });
      const answer = await adminAiInsightsService.buildPostActionInsight(
        userId,
        "product",
        `Product created: ${created.name}`
      );

      return res.json({
        success: true,
        answer,
        cards: [
          {
            type: "product",
            id: created._id.toString(),
            title: created.name,
            subtitle: `$${Number(created.price).toFixed(2)} - Stock ${created.stock_quantity}`,
            details: {
              name: created.name,
              description: created.description,
              price: created.price,
              stock: created.stock_quantity,
              category: created.category,
              image: created.image_url,
            },
          },
        ],
        entity: created,
      });
    }

    return res.status(400).json({ success: false, message: "Unsupported interactive operation" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Interactive submit failed";
    if (message.startsWith("GEMINI_QUOTA_EXCEEDED")) {
      return res.status(200).json({
        success: true,
        answer: "Entity saved successfully. AI confirmation is temporarily rate-limited.",
        rateLimited: true,
      });
    }
    return res.status(500).json({ success: false, message });
  }
});

router.post("/reset-conversation", authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : undefined;
    adminConversationalAiService.resetSession({ userId, sessionId });
    return res.json({ success: true, message: "Conversation state reset" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to reset conversation" });
  }
});

router.post("/", preserveRawInput, (req, res, next) => {
  req.url = "/ask";
  (router as unknown as { handle: (request: unknown, response: unknown, done: unknown) => void }).handle(
    req,
    res,
    next
  );
});

router.get("/ping", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

router.get("/help", authenticate, requireAdmin, getAiGuide);

export default router;
