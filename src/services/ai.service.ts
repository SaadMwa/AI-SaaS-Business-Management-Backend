import { env } from "../config/env";
import { logger } from "../utils/logger";

type TopProduct = {
  name: string;
  quantity: number;
  revenue: number;
};

type MaybeDate = string | Date | null | undefined;

type BusinessData = Record<string, any> & {
  totalCustomers: number;
  salesLast30Days: number;
  revenueLast30Days: number;
  monthlyRevenue: number;
  topProducts: TopProduct[];
  lastCustomer?: { name?: string | null; email?: string | null; phone?: string | null; createdAt?: MaybeDate } | null;
  recentCustomers?: Array<{ name?: string | null; email?: string | null; phone?: string | null; createdAt?: MaybeDate }>;
  lastSale?: { total?: number; status?: string; createdAt?: MaybeDate; customerId?: { name?: string | null; email?: string | null } | string } | null;
  recentSales?: Array<{ total?: number; status?: string; createdAt?: MaybeDate; customerId?: { name?: string | null; email?: string | null } | string }>;
  topCustomers?: Array<{ customerId?: string | { toString?: () => string } | null; name?: string | null; email?: string | null; revenue?: number; orders?: number }>;
  avgOrderValue30Days?: number;
  monthlyRevenueSeries?: { year: number; month: number; revenue: number; sales: number }[];
  uniqueCustomers?: number;
  repeatCustomers?: number;
  repeatRate?: number;
  inactiveCustomers?: number;
  taskSummary?: {
    totalTasks: number;
    tasksByStatus: Record<string, number>;
    overdueTasks: number;
    dueSoonTasks: number;
    highPriorityTasks: number;
    urgentTasks: number;
    unassignedTasks: number;
    topTags: { tag: string; count: number }[];
    recentTasks: Array<{ title?: string; description?: string; dueDate?: MaybeDate; status?: string; priority?: string; tags?: string[] }>;
  };
};

type ChatTurn = { role: "user" | "ai"; message: string };

type GeminiCallOptions = {
  timeoutMs?: number;
  temperature?: number;
  maxOutputTokens?: number;
  maxContinuationRounds?: number;
  minDesiredChars?: number;
};

type GeminiApiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
    finish_reason?: string;
  }>;
};

const GEMINI_MAX_OUTPUT_TOKENS_DEFAULT = 5000;
const MAX_CONTINUATION_ROUNDS_DEFAULT = 3;
const TRUNCATION_FINISH_REASONS = new Set(["MAX_TOKENS", "LENGTH"]);
const SHORT_RESPONSE_THRESHOLD = 180;

const normalizeFinishReason = (reason?: string) =>
  typeof reason === "string" ? reason.trim().toUpperCase() : "";

const isTruncationFinishReason = (reason?: string) =>
  TRUNCATION_FINISH_REASONS.has(normalizeFinishReason(reason));

const looksAbruptlyCut = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < SHORT_RESPONSE_THRESHOLD) {
    return false;
  }
  if (/[.!?)]$/.test(trimmed)) {
    return false;
  }
  return /[:;,(\-]$/.test(trimmed) || !/\s/.test(trimmed.slice(-2));
};

const buildContinuationPrompt = (
  originalPrompt: string,
  partialAnswer: string,
  stepLabel?: string
) => [
  "Continue the previous answer from exactly where it stopped.",
  "Do not repeat prior text. Return only the missing continuation.",
  "If useful, continue with clear headings and numbered steps.",
  stepLabel ? `Resume from this context: ${stepLabel}` : null,
  "",
  "Original request context:",
  originalPrompt.slice(-5000),
  "",
  "Answer generated so far:",
  partialAnswer.slice(-7000),
]
  .filter(Boolean)
  .join("\n");

const mergeAnswer = (base: string, continuation: string) => {
  if (!continuation) return base;
  if (!base) return continuation;
  return `${base.trimEnd()}\n${continuation.trimStart()}`.trim();
};

const sanitizeModelOutput = (text: string) =>
  text
    .replace(/i do not have direct access to[^.]*\./gi, "I analyzed your current business data and records.")
    .replace(/i can't access your (?:data|database)[^.]*\./gi, "I used your latest data snapshot for this response.");

const extractCandidateText = (data: GeminiApiResponse) =>
  (data.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();

const extractFinishReason = (data: GeminiApiResponse) =>
  data.candidates?.[0]?.finishReason ?? data.candidates?.[0]?.finish_reason;

export const PROMPT_TEMPLATES = {
  detailedAssistantSystem:
    "You are a detailed, thorough AI assistant. Always provide complete, structured responses. If the answer is long, do not truncate. If required, split the answer into multiple parts.",
  memorySummarySystem:
    "You summarize long conversations into compact, durable memory. Keep key facts, decisions, constraints, and unresolved questions.",
};

export const buildFallbackResponse = (question: string, data: any) => {
  const topProductNames =
    (data.topProducts || []).map((item: { name?: string }) => item.name).join(", ") ||
    "No product data";
  const taskSummary = data.taskSummary;
  return [
    "AI response timed out. Here is a quick summary based on current data.",
    "",
    "Insights:",
    `- Total customers: ${data.totalCustomers}`,
    `- Sales in last 30 days: ${data.salesLast30Days}`,
    `- Revenue in last 30 days: ${data.revenueLast30Days}`,
    `- Monthly revenue: ${data.monthlyRevenue}`,
    `- Top products: ${topProductNames}`,
    taskSummary ? `- Total tasks: ${taskSummary.totalTasks}` : "",
    taskSummary ? `- Overdue tasks: ${taskSummary.overdueTasks}` : "",
    taskSummary ? `- Due soon tasks: ${taskSummary.dueSoonTasks}` : "",
    "",
    "Actions:",
    "- Review recent sales for upsell opportunities.",
    "- Reach out to recent customers for feedback.",
    "- Focus marketing on the top products listed above.",
    taskSummary ? "- Tackle overdue tasks and assign owners." : "",
    "",
    `Question: ${question}`,
  ]
    .filter(Boolean)
    .join("\n");
};

const compactList = <T,>(items?: T[], limit = 3) => (Array.isArray(items) ? items.slice(0, limit) : items);

const buildPrompt = (question: string, businessData: any) => `
You are a SaaS business analyst. Answer the user's question directly and briefly.
If the question cannot be answered with the data provided, say so and ask one clarifying question.

Business data:
customers=${businessData.totalCustomers}
sales_30d=${businessData.salesLast30Days}
revenue_30d=${businessData.revenueLast30Days}
monthly_revenue=${businessData.monthlyRevenue}
top_products=${JSON.stringify(compactList(businessData.topProducts))}
last_customer=${JSON.stringify(businessData.lastCustomer)}
recent_customers=${JSON.stringify(compactList(businessData.recentCustomers))}
last_sale=${JSON.stringify(businessData.lastSale)}
recent_sales=${JSON.stringify(compactList(businessData.recentSales))}
top_customers=${JSON.stringify(compactList(businessData.topCustomers))}
avg_order_value_30d=${businessData.avgOrderValue30Days}
monthly_revenue_series=${JSON.stringify(compactList(businessData.monthlyRevenueSeries, 6))}
unique_customers=${businessData.uniqueCustomers}
repeat_customers=${businessData.repeatCustomers}
repeat_rate=${businessData.repeatRate}
inactive_customers=${businessData.inactiveCustomers}
tasks_total=${businessData.taskSummary?.totalTasks}
tasks_by_status=${JSON.stringify(businessData.taskSummary?.tasksByStatus || {})}
overdue_tasks=${businessData.taskSummary?.overdueTasks}
due_soon_tasks=${businessData.taskSummary?.dueSoonTasks}
high_priority_tasks=${businessData.taskSummary?.highPriorityTasks}
urgent_tasks=${businessData.taskSummary?.urgentTasks}
unassigned_tasks=${businessData.taskSummary?.unassignedTasks}
top_tags=${JSON.stringify(compactList(businessData.taskSummary?.topTags, 5))}
recent_tasks=${JSON.stringify(compactList(businessData.taskSummary?.recentTasks, 5))}

Question: ${question}
Respond in this exact format:
Answer: <1-2 sentences>
Evidence:
- <bullet citing specific data fields above>
- <bullet citing specific data fields above>
Next steps:
- <bullet>
- <bullet>
Keep it concise and directly tied to the data.
`;

export async function askAIStream(
  question: string,
  businessData: BusinessData,
  onToken: (token: string) => void
) {
  const answer = await askAIOnce(question, businessData, 60000);
  onToken(answer);
}

const callGemini = async (prompt: string, options: GeminiCallOptions = {}) => {
  const fetchFn =
    typeof fetch === "function"
      ? fetch
      : (await import("node-fetch")).default;

  if (!env.geminiApiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const model = env.geminiModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const timeoutMs = options.timeoutMs ?? 60000;
  const maxOutputTokens = options.maxOutputTokens ?? GEMINI_MAX_OUTPUT_TOKENS_DEFAULT;
  const maxContinuationRounds = options.maxContinuationRounds ?? MAX_CONTINUATION_ROUNDS_DEFAULT;
  const minDesiredChars = options.minDesiredChars ?? SHORT_RESPONSE_THRESHOLD;

  const callSingleGeminiPass = async (inputPrompt: string) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.geminiApiKey,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: inputPrompt }] }],
          generationConfig: {
            temperature: options.temperature ?? 0.2,
            maxOutputTokens,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        if (response.status === 429) {
          let retryAfterSeconds = 60;
          try {
            const parsed = JSON.parse(text) as {
              error?: { details?: { retryDelay?: string }[] };
            };
            const retryDelay = parsed.error?.details?.find((item) => item.retryDelay)?.retryDelay;
            if (retryDelay) {
              const match = retryDelay.match(/(\d+)/);
              if (match) retryAfterSeconds = Number(match[1]);
            }
          } catch {
            // Ignore parse failures and use default retryAfterSeconds.
          }
          throw new Error(`GEMINI_QUOTA_EXCEEDED:${retryAfterSeconds}`);
        }
        throw new Error(`Gemini error: ${response.status} ${text}`);
      }

      const data = (await response.json()) as GeminiApiResponse;
      return {
        text: extractCandidateText(data),
        finishReason: extractFinishReason(data),
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Gemini timeout");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };

  let rounds = 0;
  let currentPrompt = prompt;
  let fullText = "";

  try {
    while (rounds <= maxContinuationRounds) {
      const pass = await callSingleGeminiPass(currentPrompt);
      fullText = mergeAnswer(fullText, pass.text);
      const truncatedByTokens = isTruncationFinishReason(pass.finishReason);
      const tooShort = fullText.length < minDesiredChars;
      const abruptCut = looksAbruptlyCut(fullText);
      const needsContinuation = truncatedByTokens || (rounds === 0 && tooShort && abruptCut);

      if (!needsContinuation || rounds === maxContinuationRounds) {
        return sanitizeModelOutput(fullText.trim());
      }

      rounds += 1;
      currentPrompt = buildContinuationPrompt(prompt, fullText);
    }
  } catch (error) {
    logger.error("gemini_call_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  return sanitizeModelOutput(fullText.trim());
};

export async function askAIOnce(
  question: string,
  businessData: any,
  timeoutMs = 60000
) {
  const prompt = buildPrompt(question, businessData);
  return callGemini(prompt, {
    timeoutMs,
    temperature: 0.2,
    maxOutputTokens: 4000,
    minDesiredChars: 240,
  });
}

const buildChatPrompt = (question: string) => `
You are a friendly AI co-founder helping the user build their SaaS business.
Be clear, practical, and honest.
Do not claim to run system actions or call APIs. Offer guidance only.
Always provide a complete answer. If the answer is long, split it into "Part 1", "Part 2", etc.

User: ${question}
`;

const buildAdvisorPrompt = (question: string, businessData: any) => `
You are a strategic business advisor for a SaaS company.
Provide clear, prioritized recommendations grounded in the data below.
Do not claim to run system actions or call APIs. Offer guidance only.
Use short bullets. If the data is limited, say so and suggest what to track.

Business data:
customers=${businessData.totalCustomers}
sales_30d=${businessData.salesLast30Days}
revenue_30d=${businessData.revenueLast30Days}
monthly_revenue=${businessData.monthlyRevenue}
top_products=${JSON.stringify(compactList(businessData.topProducts))}
top_customers=${JSON.stringify(compactList(businessData.topCustomers))}
avg_order_value_30d=${businessData.avgOrderValue30Days}
repeat_rate=${businessData.repeatRate}
inactive_customers=${businessData.inactiveCustomers}
tasks_total=${businessData.taskSummary?.totalTasks}
overdue_tasks=${businessData.taskSummary?.overdueTasks}
unassigned_tasks=${businessData.taskSummary?.unassignedTasks}

User: ${question}
`;

export async function askChatOnce(question: string, timeoutMs = 60000) {
  const prompt = buildChatPrompt(question);
  return callGemini(prompt, {
    timeoutMs,
    temperature: 0.6,
    maxOutputTokens: 5000,
    minDesiredChars: 220,
  });
}

export async function askAdvisorOnce(
  question: string,
  businessData: any,
  timeoutMs = 60000
) {
  const prompt = buildAdvisorPrompt(question, businessData);
  return callGemini(prompt, {
    timeoutMs,
    temperature: 0.3,
    maxOutputTokens: 5000,
    minDesiredChars: 260,
  });
}

const buildMemoryPrompt = (params: {
  system: string;
  longTermMemory: string[];
  conversationSummary?: string | null;
  history: ChatTurn[];
  userMessage: string;
  includeBusinessData?: string;
}) => {
  const memoryBlock = params.longTermMemory.length
    ? params.longTermMemory.map((item) => `- ${item}`).join("\n")
    : "No long-term memory yet.";

  const summaryBlock = params.conversationSummary
    ? params.conversationSummary
    : "No prior summary.";

  const historyBlock = params.history.length
    ? params.history.map((item) => `${item.role.toUpperCase()}: ${item.message}`).join("\n")
    : "No recent history.";

  return [
    `SYSTEM: ${params.system}`,
    "",
    "CONVERSATION SUMMARY:",
    summaryBlock,
    "",
    "LONG-TERM MEMORY:",
    memoryBlock,
    "",
    "CHAT HISTORY:",
    historyBlock,
    "",
    params.includeBusinessData ? "BUSINESS DATA:" : null,
    params.includeBusinessData ? params.includeBusinessData : null,
    "",
    `USER: ${params.userMessage}`,
  ]
    .filter(Boolean)
    .join("\n");
};

export async function askChatWithMemory(
  question: string,
  longTermMemory: string[],
  conversationSummary: string | null,
  history: ChatTurn[],
  timeoutMs = 60000
) {
  const prompt = buildMemoryPrompt({
    system: `${PROMPT_TEMPLATES.detailedAssistantSystem} Use memory naturally and keep practical recommendations specific.`,
    longTermMemory,
    conversationSummary,
    history,
    userMessage: question,
  });
  return callGemini(prompt, {
    timeoutMs,
    temperature: 0.6,
    maxOutputTokens: 5000,
    minDesiredChars: 260,
  });
}

export async function askAdvisorWithMemory(
  question: string,
  businessData: any,
  longTermMemory: string[],
  conversationSummary: string | null,
  history: ChatTurn[],
  timeoutMs = 60000
) {
  const businessDataText = [
    `customers=${businessData.totalCustomers}`,
    `sales_30d=${businessData.salesLast30Days}`,
    `revenue_30d=${businessData.revenueLast30Days}`,
    `monthly_revenue=${businessData.monthlyRevenue}`,
    `top_products=${JSON.stringify(compactList(businessData.topProducts))}`,
    `top_customers=${JSON.stringify(compactList(businessData.topCustomers))}`,
    `avg_order_value_30d=${businessData.avgOrderValue30Days}`,
    `repeat_rate=${businessData.repeatRate}`,
    `inactive_customers=${businessData.inactiveCustomers}`,
    `tasks_total=${businessData.taskSummary?.totalTasks}`,
    `overdue_tasks=${businessData.taskSummary?.overdueTasks}`,
    `unassigned_tasks=${businessData.taskSummary?.unassignedTasks}`,
  ].join("\n");

  const prompt = buildMemoryPrompt({
    system:
      `${PROMPT_TEMPLATES.detailedAssistantSystem} You are a strategic business advisor for a SaaS company. Provide clear, prioritized recommendations grounded in the data below. Do not claim to run system actions or call APIs.`,
    longTermMemory,
    conversationSummary,
    history,
    userMessage: question,
    includeBusinessData: businessDataText,
  });
  return callGemini(prompt, {
    timeoutMs,
    temperature: 0.3,
    maxOutputTokens: 5000,
    minDesiredChars: 300,
  });
}

export async function askAdminEntityWithGemini(params: {
  question: string;
  entityType: "task" | "customer" | "sale" | "product";
  records: unknown[];
  memoryHint?: string;
  modeHint?: "Analytics" | "Inventory" | "CRM" | "Operations" | "Strategy";
  timeoutMs?: number;
}) {
  const prompt = [
    "You are an admin AI assistant for a SaaS dashboard.",
    "Write a friendly, accurate response using only the provided records.",
    "Never invent ids, prices, stock values, statuses, or names that are absent in records.",
    "If records are empty, clearly say no matching data was found.",
    "Keep it concise and useful.",
    "Add one short follow-up suggestion.",
    "",
    `Entity type: ${params.entityType}`,
    params.modeHint ? `Mode: ${params.modeHint}` : null,
    params.memoryHint ? `Session context: ${params.memoryHint}` : null,
    `Admin question: ${params.question}`,
    `Records JSON: ${JSON.stringify(params.records)}`,
  ]
    .filter(Boolean)
    .join("\n");

  return callGemini(prompt, {
    timeoutMs: params.timeoutMs ?? 45000,
    temperature: 0.3,
    maxOutputTokens: 1200,
    minDesiredChars: 120,
    maxContinuationRounds: 1,
  });
}

export async function summarizeConversationHistory(
  history: ChatTurn[],
  previousSummary: string | null,
  timeoutMs = 60000
) {
  if (!history.length) {
    return previousSummary;
  }

  const historyText = history
    .map((item) => `${item.role.toUpperCase()}: ${item.message}`)
    .join("\n");

  const prompt = [
    `SYSTEM: ${PROMPT_TEMPLATES.memorySummarySystem}`,
    "Write a compact summary with these sections:",
    "1) User profile/facts",
    "2) Stable preferences",
    "3) Decisions and commitments",
    "4) Open threads / unresolved asks",
    "5) Recent context to preserve",
    "Use concise bullets. Keep names, dates, and constraints.",
    "",
    "Existing summary:",
    previousSummary || "None",
    "",
    "Older conversation to compress:",
    historyText,
  ].join("\n");

  return callGemini(prompt, {
    timeoutMs,
    temperature: 0.2,
    maxOutputTokens: 1200,
    maxContinuationRounds: 1,
    minDesiredChars: 200,
  });
}

export async function interpretIntentWithLLM(rawText: string) {
  const fetchFn =
    typeof fetch === "function"
      ? fetch
      : (await import("node-fetch")).default;

  if (!env.geminiApiKey) {
    return null;
  }

  const model = env.geminiModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const prompt = [
    "You are a strict intent parser for a business CRM + task agent.",
    "Return ONLY valid JSON. No markdown, no commentary, no code fences.",
    "Do NOT rewrite the user's words.",
    "Intent must be one of:",
    "create_task, update_task, delete_task, assign_task, change_status, change_priority, list_tasks, chat,",
    "create_customer, update_customer, delete_customer, view_customer, list_customers,",
    "create_sale, update_sale, delete_sale, view_sale, assign_sale, change_sale_status, list_sales",
    "Output JSON keys:",
    "intent, task_number, customer_number, sale_number, title, customer, sale, updates, assignee_email, status, priority, list_filters, confidence, rationale.",
    "Rules:",
    "- task_number is number or null.",
    "- customer_number is number or null.",
    "- sale_number is number or null.",
    "- updates is an object with fields to change.",
    "- For create_task include title if explicit, else null.",
    "- For create_customer include customer: { name, email, phone, address } when provided.",
    "- For create_sale include sale: { customer_number, status } when provided.",
    "User text:",
    rawText,
  ].join("\n");

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
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 512,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gemini error: ${response.status} ${text}`);
    }

    const data = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("LLM did not return JSON");
    }
    const parsed = JSON.parse(match[0]);

    return {
      intent: parsed.intent || "chat",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.6,
      entities: {
        taskNumber: typeof parsed.task_number === "number" ? parsed.task_number : undefined,
        taskTitle: typeof parsed.title === "string" ? parsed.title : undefined,
        customerNumber:
          typeof parsed.customer_number === "number"
            ? parsed.customer_number
            : typeof parsed.customer_number === "string"
            ? Number(parsed.customer_number.replace(/\D/g, "")) || undefined
            : typeof parsed.sale?.customer_number === "number"
            ? parsed.sale.customer_number
            : typeof parsed.sale?.customer_number === "string"
            ? Number(parsed.sale.customer_number.replace(/\D/g, "")) || undefined
            : undefined,
        saleNumber:
          typeof parsed.sale_number === "number"
            ? parsed.sale_number
            : typeof parsed.sale_number === "string"
            ? Number(parsed.sale_number.replace(/\D/g, "")) || undefined
            : undefined,
        customerName: parsed.customer?.name,
        customerEmail: parsed.customer?.email,
        customerPhone: parsed.customer?.phone,
        customerAddress: parsed.customer?.address,
        saleStatus: parsed.sale?.status || parsed.status,
        assigneeEmail:
          typeof parsed.assignee_email === "string" ? parsed.assignee_email : undefined,
        assigneeName:
          typeof parsed.assignee_name === "string"
            ? parsed.assignee_name
            : typeof parsed.assignee === "string"
            ? parsed.assignee
            : undefined,
        priority: typeof parsed.priority === "string" ? parsed.priority : undefined,
        status: typeof parsed.status === "string" ? parsed.status : undefined,
        dueDate: parsed.updates?.due_date || parsed.updates?.dueDate,
        updates: typeof parsed.updates === "object" && parsed.updates ? parsed.updates : undefined,
      },
      rationale: Array.isArray(parsed.rationale) ? parsed.rationale : [],
    };
  } catch (error) {
    logger.warn("gemini_intent_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
