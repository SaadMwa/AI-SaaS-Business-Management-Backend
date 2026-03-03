import { perceiveInput } from "../perception/perception";
import { normalizeWithDictionary } from "../../utils/fuzzy";

export type AiIntentKind = "action" | "query" | "unknown";
export type AiActionType = "create" | "update" | "delete" | "assign" | "unassign" | "list";
export type AiEntityType = "task" | "customer" | "sale" | "product";
export type AiQueryType =
  | "lastCustomer"
  | "recentCustomers"
  | "totalCustomers"
  | "lastSale"
  | "recentSales"
  | "salesSummary"
  | "revenueLast30Days"
  | "salesLast30Days"
  | "monthlyRevenue"
  | "topProducts"
  | "topCustomers"
  | "repeatRate"
  | "inactiveCustomers"
  | "avgOrderValue30Days"
  | "monthlyRevenueSeries"
  | "taskSummary"
  | "taskSuggestions"
  | "taskAutoTag"
  | "recentTasks";

export type AiIntentResult = {
  kind: AiIntentKind;
  action?: AiActionType;
  entityType?: AiEntityType;
  entityNumber?: number;
  queryType?: AiQueryType;
  updates?: Record<string, unknown>;
  confidence: number;
  normalized: string;
};

const normalize = (text: string) =>
  normalizeWithDictionary(text, {
    creat: "create",
    crate: "create",
    tsk: "task",
    taks: "task",
    updte: "update",
    updat: "update",
    prduct: "product",
    prodct: "product",
    cusomer: "customer",
    custmer: "customer",
    assgin: "assign",
    unasign: "unassign",
    stcok: "stock",
  })
    .toLowerCase()
    .replace(/[^a-z0-9\s#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const hasAny = (text: string, terms: string[]) => terms.some((term) => text.includes(term));

const detectEntityType = (text: string): AiEntityType | undefined => {
  if (hasAny(text, ["task", "todo", "to-do"])) return "task";
  if (hasAny(text, ["customer", "client", "account"])) return "customer";
  if (hasAny(text, ["sale", "order", "invoice"])) return "sale";
  if (hasAny(text, ["product", "item", "catalog", "stock"])) return "product";
  return undefined;
};

const detectAction = (text: string): AiActionType | undefined => {
  if (hasAny(text, ["create", "add", "new"])) return "create";
  if (hasAny(text, ["update", "change", "edit", "set"])) return "update";
  if (hasAny(text, ["delete", "remove", "cancel"])) return "delete";
  if (hasAny(text, ["unassign", "clear assignee", "remove assignee"])) return "unassign";
  if (hasAny(text, [" assign", "assign ", "allocate"])) return "assign";
  if (hasAny(text, ["list", "show", "view"])) return "list";
  return undefined;
};

const detectQueryType = (text: string): AiQueryType | undefined => {
  if (hasAny(text, ["latest customer", "most recent customer", "last customer"]))
    return "lastCustomer";
  if (hasAny(text, ["recent customers", "latest customers"]))
    return "recentCustomers";
  if (hasAny(text, ["total customers", "how many customers"]))
    return "totalCustomers";
  if (hasAny(text, ["latest sale", "most recent sale", "last sale"]))
    return "lastSale";
  if (hasAny(text, ["recent sales", "latest sales"]))
    return "recentSales";
  if (hasAny(text, ["sales summary", "summarize sales"]))
    return "salesSummary";
  if (hasAny(text, ["revenue last 30", "last 30 days revenue"]))
    return "revenueLast30Days";
  if (hasAny(text, ["sales last 30", "orders last 30"]))
    return "salesLast30Days";
  if (hasAny(text, ["monthly revenue"]))
    return "monthlyRevenue";
  if (hasAny(text, ["top product", "top products"]))
    return "topProducts";
  if (hasAny(text, ["top customer", "top customers"]))
    return "topCustomers";
  if (hasAny(text, ["repeat rate", "repeat customer"]))
    return "repeatRate";
  if (hasAny(text, ["inactive customer", "inactive customers"]))
    return "inactiveCustomers";
  if (hasAny(text, ["average order", "avg order"]))
    return "avgOrderValue30Days";
  if (hasAny(text, ["trend", "monthly trend", "revenue trend"]))
    return "monthlyRevenueSeries";
  if (hasAny(text, ["task summary", "summarize tasks"]))
    return "taskSummary";
  if (hasAny(text, ["suggest", "recommend"]) && text.includes("task"))
    return "taskSuggestions";
  if (hasAny(text, ["auto tag", "tag tasks", "label tasks"]))
    return "taskAutoTag";
  if (hasAny(text, ["recent task", "recent tasks", "latest task", "latest tasks"]))
    return "recentTasks";
  return undefined;
};

export const detectAiIntent = (text: string): AiIntentResult => {
  const normalized = normalize(text);
  const perception = perceiveInput(text);

  const queryType = detectQueryType(normalized);
  if (queryType) {
    return {
      kind: "query",
      queryType,
      confidence: 0.75,
      normalized,
    };
  }

  const action = detectAction(normalized);
  const entityType = detectEntityType(normalized);
  const entityNumber =
    perception.entities.taskNumber ||
    perception.entities.customerNumber ||
    perception.entities.saleNumber;

  if (action && entityType) {
    const confidence = entityNumber ? 0.7 : 0.55;
    return {
      kind: "action",
      action,
      entityType,
      entityNumber,
      updates: perception.entities.updates,
      confidence,
      normalized,
    };
  }

  return {
    kind: "unknown",
    confidence: 0.2,
    normalized,
  };
};
