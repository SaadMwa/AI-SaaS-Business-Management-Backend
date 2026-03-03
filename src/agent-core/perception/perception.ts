import { AgentEntity } from "../types";

const formatDate = (date: Date) => date.toISOString().split("T")[0];

const parseDueDate = (text: string) => {
  const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];
  const now = new Date();
  if (text.includes("today")) return formatDate(now);
  if (text.includes("tomorrow")) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return formatDate(d);
  }
  if (text.includes("next week")) {
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    return formatDate(d);
  }
  if (text.includes("next month")) {
    const d = new Date(now);
    d.setMonth(d.getMonth() + 1);
    return formatDate(d);
  }
  return undefined;
};

const parsePriority = (text: string) => {
  if (text.includes("urgent")) return "urgent";
  if (text.includes("high")) return "high";
  if (text.includes("medium")) return "medium";
  if (text.includes("low")) return "low";
  return undefined;
};

const parseStatus = (text: string) => {
  if (text.includes("in progress") || text.includes("in-progress")) return "in_progress";
  if (text.includes("blocked")) return "blocked";
  if (text.includes("todo") || text.includes("to do")) return "todo";
  if (text.includes("done") || text.includes("complete")) return "done";
  return undefined;
};

const parseSaleStatus = (text: string) => {
  if (text.includes("draft")) return "draft";
  if (text.includes("pending")) return "pending";
  if (text.includes("paid")) return "paid";
  if (text.includes("cancelled")) return "cancelled";
  if (text.includes("refunded")) return "refunded";
  return undefined;
};
const parseTaskId = (text: string) => {
  const match = text.match(/\b[a-f0-9]{24}\b/i);
  return match ? match[0] : undefined;
};

const parseTaskNumber = (text: string) => {
  const match =
    text.match(/\btask\s+#?(\d{1,6})\b/i) ||
    text.match(/\btask\s+number\s+(\d{1,6})\b/i) ||
    text.match(/\B#(\d{1,6})\b/);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
};

const parseCustomerNumber = (text: string) => {
  const match =
    text.match(/\bcustomer\s+#?(\d{1,8})\b/i) ||
    text.match(/\bcustomer\s+number\s+(\d{1,8})\b/i) ||
    text.match(/\bC(\d{1,8})\b/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
};

const parseSaleNumber = (text: string) => {
  const match =
    text.match(/\bsale\s+#?(\d{1,8})\b/i) ||
    text.match(/\bsale\s+number\s+(\d{1,8})\b/i) ||
    text.match(/\bS(\d{1,8})\b/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
};
const parseAssigneeEmail = (text: string) => {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : undefined;
};

const parseAssigneeName = (text: string) => {
  if (parseAssigneeEmail(text)) return undefined;
  const match =
    text.match(/\bassign(?:ed)?\s+(?:task\s+)?(?:to\s+)?([A-Za-z][A-Za-z' -]{1,40})\b/i) ||
    text.match(/\bassignee\s+(?:to\s+)?([A-Za-z][A-Za-z' -]{1,40})\b/i) ||
    text.match(/\bassigned\s+user\s+to\s+([A-Za-z][A-Za-z' -]{1,40})\b/i);
  if (!match?.[1]) return undefined;
  return match[1].trim();
};
const parseCustomerName = (text: string) => {
  const match = text.match(/\b(create|add|new)\s+customer\s+(.+)/i);
  if (!match || !match[2]) return undefined;
  const raw = match[2];
  const cleaned = raw
    .replace(/\bwith\s+email\b.*$/i, "")
    .replace(/\bemail\b.*$/i, "")
    .replace(/\bphone\b.*$/i, "")
    .replace(/\baddress\b.*$/i, "")
    .trim();
  return cleaned || raw.trim();
};

const parseCustomerEmail = (text: string) => {
  const match = text.match(/email\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  if (match?.[1]) return match[1];
  return parseAssigneeEmail(text);
};

const parseCustomerPhone = (text: string) => {
  const match = text.match(/\bphone\s+(to\s+)?([+\d][\d\s-]{6,})/i);
  return match ? match[2].trim() : undefined;
};

const parseCustomerAddress = (text: string) => {
  const match = text.match(/\baddress\s+(.+)/i);
  return match ? match[1].trim() : undefined;
};

const parseCustomerUpdateFields = (text: string) => {
  const updates: Record<string, unknown> = {};
  const phoneMatch = text.match(/\bphone\s+(to\s+)?([+\d][\d\s-]{6,})/i);
  if (phoneMatch?.[2]) updates.phone = phoneMatch[2].trim();
  const emailMatch = text.match(/\bemail\s+(to\s+)?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  if (emailMatch?.[2]) updates.email = emailMatch[2].trim();
  const nameMatch = text.match(/\bname\s+(to\s+)?(.+)/i);
  if (nameMatch?.[2]) updates.name = nameMatch[2].trim();

  if (/\b(remove|clear|delete)\s+phone\b/i.test(text)) updates.phone = null;
  if (/\b(remove|clear|delete)\s+email\b/i.test(text)) updates.email = null;
  if (/\b(remove|clear|delete)\s+address\b/i.test(text)) updates.address = null;

  return Object.keys(updates).length ? updates : undefined;
};

const parseTaskUpdateFields = (text: string) => {
  const updates: Record<string, unknown> = {};
  const titleMatch = text.match(/\btitle\s+(to\s+)?(.+)/i);
  if (titleMatch?.[2]) updates.title = titleMatch[2].trim();
  const descriptionMatch = text.match(/\bdescription\s+(to\s+)?(.+)/i);
  if (descriptionMatch?.[2]) updates.description = descriptionMatch[2].trim();
  const dueMatch = text.match(/\b(due\s+date|due)\s+(to\s+)?(\d{4}-\d{2}-\d{2})/i);
  if (dueMatch?.[3]) updates.dueDate = dueMatch[3].trim();
  const priorityMatch = text.match(/\bpriority\s+(to\s+)?(low|medium|high|urgent)\b/i);
  if (priorityMatch?.[2]) updates.priority = priorityMatch[2].toLowerCase();
  const statusMatch = text.match(/\bstatus\s+(to\s+)?(todo|in[-_ ]progress|blocked|done)\b/i);
  if (statusMatch?.[2]) {
    updates.status = statusMatch[2].replace("in-progress", "in_progress").replace("in progress", "in_progress");
  }

  if (/\b(remove|clear|delete)\s+description\b/i.test(text)) updates.description = null;
  if (/\b(remove|clear|delete)\s+due\b/i.test(text)) updates.dueDate = null;
  if (/\b(remove|clear|delete|unassign)\s+assignee\b/i.test(text) || /\bunassign\b/i.test(text)) {
    updates.assignedTo = null;
  }
  const assigneeName = parseAssigneeName(text);
  if (assigneeName) updates.assigneeName = assigneeName;

  return Object.keys(updates).length ? updates : undefined;
};

const parseSaleUpdateFields = (text: string) => {
  const updates: Record<string, unknown> = {};
  const statusMatch = text.match(/\bstatus\s+(to\s+)?(draft|pending|paid|cancelled|refunded)\b/i);
  if (statusMatch?.[2]) updates.status = statusMatch[2].toLowerCase();
  const customerMatch = text.match(/\bcustomer\s+(to\s+)?(#?\d{1,8}|C\d{1,8})\b/i);
  if (customerMatch?.[2]) {
    const parsed = Number(customerMatch[2].replace(/\D/g, ""));
    if (Number.isFinite(parsed)) updates.customerNumber = parsed;
  }
  const paymentMatch = text.match(/\bpayment\s+method\s+(to\s+)?(card|bank_transfer|cash|paypal|other)\b/i);
  if (paymentMatch?.[2]) updates.paymentMethod = paymentMatch[2].toLowerCase();
  const dateMatch = text.match(/\bdate\s+(to\s+)?(\d{4}-\d{2}-\d{2})\b/i);
  if (dateMatch?.[2]) updates.date = dateMatch[2].trim();

  if (/\b(remove|clear|delete|unassign)\s+assignee\b/i.test(text) || /\bunassign\b/i.test(text)) {
    updates.assignedTo = null;
  }
  if (/\b(remove|clear|delete)\s+date\b/i.test(text)) updates.date = null;
  const assigneeName = parseAssigneeName(text);
  if (assigneeName) updates.assigneeName = assigneeName;

  return Object.keys(updates).length ? updates : undefined;
};

const parseConfirmation = (text: string) => {
  return /\b(confirm|yes|approve|do it|go ahead)\b/i.test(text);
};

export type PerceptionResult = {
  raw: string;
  normalized: string;
  entities: AgentEntity;
  isDestructive: boolean;
};

export const perceiveInput = (text: string): PerceptionResult => {
  const normalized = text.trim().toLowerCase();
  const entities: AgentEntity = {
    taskId: parseTaskId(normalized),
    taskNumber: parseTaskNumber(normalized),
    customerNumber: parseCustomerNumber(text),
    saleNumber: parseSaleNumber(text),
    customerName: parseCustomerName(text),
    customerEmail: parseCustomerEmail(text),
    customerPhone: parseCustomerPhone(text),
    customerAddress: parseCustomerAddress(text),
    assigneeEmail: parseAssigneeEmail(text),
    priority: parsePriority(normalized),
    status: parseStatus(normalized),
    saleStatus: parseSaleStatus(normalized),
    dueDate: parseDueDate(normalized),
    confirmation: parseConfirmation(normalized),
    assigneeName: parseAssigneeName(text),
  };

  const customerUpdates = parseCustomerUpdateFields(text);
  if (customerUpdates) {
    entities.updates = { ...(entities.updates || {}), ...customerUpdates };
  }
  const taskUpdates = parseTaskUpdateFields(text);
  if (taskUpdates) {
    entities.updates = { ...(entities.updates || {}), ...taskUpdates };
  }
  const saleUpdates = parseSaleUpdateFields(text);
  if (saleUpdates) {
    entities.updates = { ...(entities.updates || {}), ...saleUpdates };
  }

  const titleMatch =
    text.match(/\btitle\s+is\s+["']?([^"']+)["']?/i) ||
    text.match(/\btask\s+title\s+is\s+["']?([^"']+)["']?/i);
  if (titleMatch && titleMatch[1]) {
    const cleaned = titleMatch[1]
      .replace(/\s+and\s+make\s+the\s+priority\s+\w+/i, "")
      .replace(/\s+and\s+set\s+the\s+priority\s+\w+/i, "")
      .trim();
    entities.taskTitle = cleaned || titleMatch[1].trim();
  }

  const createMatch = text.match(/\b(create|add|new)\s+(a\s+)?task\s+(.+)/i);
  if (createMatch && createMatch[3]) {
    const rawTitle = createMatch[3]
      .replace(/\b(description|desc)\s+(is|to)\b[\s\S]*$/i, "")
      .replace(/\b(with|and)\s+(description|priority|status|due date)\b[\s\S]*$/i, "")
      .trim();
    if (rawTitle) entities.taskTitle = rawTitle;
  }

  const isDestructive =
    normalized.includes("delete") || normalized.includes("remove") || normalized.includes("cancel");

  return { raw: text, normalized, entities, isDestructive };
};
