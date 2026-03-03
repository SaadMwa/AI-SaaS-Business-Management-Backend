import { detectAiIntent } from "./aiIntentEngine";
import { detectHistoryIntent } from "./historyIntentEngine";

export type AiMode = "ACTION" | "CHAT" | "BUSINESS_ADVICE";

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const hasAny = (text: string, terms: string[]) => terms.some((term) => text.includes(term));

const isBusinessAdvice = (text: string) => {
  const businessTerms = [
    "grow",
    "growth",
    "marketing",
    "strategy",
    "improve",
    "acquisition",
    "sales",
    "revenue",
    "metrics",
    "kpi",
    "pipeline",
    "retain",
    "retention",
    "churn",
    "pricing",
    "positioning",
    "go to market",
    "go-to-market",
    "funnel",
    "conversion",
    "scale",
    "expand",
    "forecast",
    "roadmap",
    "product",
    "customer acquisition",
    "sales strategy",
    "revenue strategy",
    "startup",
    "saas",
  ];

  const questionStarters = ["how do i", "how can i", "what should i", "suggest", "advice"];
  return hasAny(text, businessTerms) || hasAny(text, questionStarters);
};

export const classifyIntent = (input: string) => {
  const normalized = normalize(input);
  const aiIntent = detectAiIntent(normalized);
  const historyIntent = detectHistoryIntent(normalized);

  if (historyIntent.kind !== "unknown") return "ACTION" as AiMode;
  if (aiIntent.kind === "action" || aiIntent.kind === "query") return "ACTION" as AiMode;
  if (isBusinessAdvice(normalized)) return "BUSINESS_ADVICE" as AiMode;

  return "CHAT" as AiMode;
};
