import { HistoryFilters } from "../../services/history.service";

export type HistoryIntentKind = "view" | "delete" | "filter" | "unknown";

export type HistoryIntentResult = {
  kind: HistoryIntentKind;
  filters: HistoryFilters;
  requiresConfirmation?: boolean;
  confirmed?: boolean;
  normalized: string;
};

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const hasAny = (text: string, terms: string[]) => terms.some((term) => text.includes(term));

const detectEntityType = (text: string): HistoryFilters["entityType"] | undefined => {
  if (hasAny(text, ["task", "tasks"])) return "task";
  if (hasAny(text, ["customer", "client", "account"])) return "customer";
  if (hasAny(text, ["sale", "sales", "order", "invoice"])) return "sale";
  if (hasAny(text, ["ai", "assistant"])) return "ai";
  return undefined;
};

const parseEntityId = (text: string) => {
  const match = text.match(/#(\d+)/);
  if (match) return Number(match[1]);
  return undefined;
};

const parseOlderThanDays = (text: string) => {
  const match = text.match(/(\d+)\s*(day|days|week|weeks|month|months|year|years)/);
  if (!match) return undefined;
  const value = Number(match[1]);
  const unit = match[2];
  if (Number.isNaN(value)) return undefined;
  if (unit.startsWith("day")) return value;
  if (unit.startsWith("week")) return value * 7;
  if (unit.startsWith("month")) return value * 30;
  if (unit.startsWith("year")) return value * 365;
  return undefined;
};

const detectConfirmation = (text: string) =>
  hasAny(text, ["confirm", "confirmed", "yes delete", "yes, delete", "proceed delete"]);

export const detectHistoryIntent = (input: string): HistoryIntentResult => {
  const normalized = normalize(input);

  const isHistoryTopic = hasAny(normalized, ["history", "log", "timeline", "audit"]);
  if (!isHistoryTopic) {
    return { kind: "unknown", filters: {}, normalized };
  }

  const entityType = detectEntityType(normalized);
  const entityId = parseEntityId(normalized);
  const olderThanDays = hasAny(normalized, ["older than", "before", "prior to"])
    ? parseOlderThanDays(normalized)
    : undefined;

  const filters: HistoryFilters = {
    entityType,
    entityId,
    olderThanDays,
  };

  if (hasAny(normalized, ["delete", "clear", "remove", "purge"])) {
    return {
      kind: "delete",
      filters,
      requiresConfirmation: true,
      confirmed: detectConfirmation(normalized),
      normalized,
    };
  }

  if (hasAny(normalized, ["filter", "only"])) {
    return { kind: "filter", filters, normalized };
  }

  return { kind: "view", filters, normalized };
};
