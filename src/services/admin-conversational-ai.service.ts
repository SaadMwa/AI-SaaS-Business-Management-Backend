import mongoose from "mongoose";
import { taskService } from "./task.service";
import { saleService } from "./sale.service";
import { Product } from "../models/product";
import { Customer } from "../models/customer";
import { User } from "../models/user";
import { levenshteinDistance } from "../utils/fuzzy";
import { AgentMemory } from "../models/agentMemory";
import { adminAiInsightsService } from "./admin-ai-insights.service";

type FlowType = "task_create" | "sale_create" | "product_create";

type AdminCard = {
  type: "task" | "sale" | "product";
  id: string;
  title: string;
  subtitle?: string;
  details: Record<string, unknown>;
};

type LastEntity = {
  entityType: "task" | "sale" | "product";
  id: string;
  entityNumber?: number | string;
  data: Record<string, unknown>;
};

type ConversationState = {
  flow: FlowType | null;
  pendingFields: string[];
  lastFieldFilled?: string;
  data: Record<string, unknown>;
  lastEntity?: LastEntity;
  updatedAt: number;
};

const SESSION_TIMEOUT_MS = 10 * 60 * 1000;

type ConversationResponse = {
  handled: boolean;
  answer: string;
  cards?: AdminCard[];
  uiAction?: {
    type: "open_form";
    entityType: "task" | "sale" | "customer" | "product";
    mode: "create" | "update";
    prefill?: Record<string, unknown>;
  };
  state: ConversationState;
  proactiveActions?: string[];
};

const SESSION_KEY_PREFIX = "ai_conversation_flow:";

const TASK_STATUS_MAP: Record<string, "todo" | "in_progress" | "done" | "blocked"> = {
  pending: "todo",
  todo: "todo",
  "to do": "todo",
  "in progress": "in_progress",
  in_progress: "in_progress",
  completed: "done",
  complete: "done",
  done: "done",
  blocked: "blocked",
};

const getSessionKey = (userId: string, sessionId?: string) => `${userId}:${sessionId || "default"}`;

const createDefaultState = (): ConversationState => ({
  flow: null,
  pendingFields: [],
  data: {},
  updatedAt: Date.now(),
});

const readState = async (userId: string, sessionId?: string) => {
  const key = getSessionKey(userId, sessionId);
  const doc = await AgentMemory.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    type: "long_term",
    key: `${SESSION_KEY_PREFIX}${key}`,
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }],
  })
    .sort({ updatedAt: -1 })
    .lean();
  const existing = doc?.content
    ? (() => {
        try {
          return JSON.parse(doc.content) as ConversationState;
        } catch {
          return null;
        }
      })()
    : null;
  const isExpired = existing ? Date.now() - existing.updatedAt > SESSION_TIMEOUT_MS : false;
  const state = !existing || isExpired ? createDefaultState() : existing;
  return { key, state };
};

const writeState = async (userId: string, key: string, state: ConversationState) => {
  state.updatedAt = Date.now();
  await AgentMemory.findOneAndUpdate(
    {
      userId: new mongoose.Types.ObjectId(userId),
      type: "long_term",
      key: `${SESSION_KEY_PREFIX}${key}`,
    },
    {
      $set: {
        content: JSON.stringify(state),
        metadata: { kind: "ai_conversation_flow" },
        expiresAt: new Date(Date.now() + SESSION_TIMEOUT_MS),
      },
    },
    { upsert: true, new: true }
  ).lean();
};

const normalize = (value: string) => value.trim().toLowerCase();

const extractValue = (message: string, labels: string[]) => {
  const lowered = message.toLowerCase();
  for (const label of labels) {
    const marker = `${label.toLowerCase()} `;
    const idx = lowered.indexOf(marker);
    if (idx >= 0) {
      return message.slice(idx + marker.length).trim().replace(/^[:=\-]\s*/, "");
    }
    const markerColon = `${label.toLowerCase()}:`;
    const idxColon = lowered.indexOf(markerColon);
    if (idxColon >= 0) {
      return message.slice(idxColon + markerColon.length).trim();
    }
  }
  return "";
};

const parseNumber = (message: string) => {
  const match = message.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const AI_TYPO_DICTIONARY: Record<string, string> = {
  creat: "create",
  craete: "create",
  updte: "update",
  delet: "delete",
  assgin: "assign",
  unasign: "unassign",
  prduct: "product",
  sal: "sale",
  custmer: "customer",
  tsk: "task",
};

const normalizeForIntent = (message: string) => {
  const base = normalize(message);
  const parts = base.split(/\s+/);
  return parts
    .map((part) => {
      if (AI_TYPO_DICTIONARY[part]) return AI_TYPO_DICTIONARY[part];
      const best = Object.keys(AI_TYPO_DICTIONARY)
        .map((key) => ({ key, score: levenshteinDistance(part, key) }))
        .sort((a, b) => a.score - b.score)[0];
      return best && best.score <= 1 ? AI_TYPO_DICTIONARY[best.key] : part;
    })
    .join(" ");
};

const startFlowFromMessage = (message: string): FlowType | null => {
  const text = normalizeForIntent(message);
  if (/\b(create|add|new)\b.*\btask\b/.test(text)) return "task_create";
  if (/\b(create|add|new)\b.*\bsale\b/.test(text)) return "sale_create";
  if (/\b(create|add|new)\b.*\bproduct\b/.test(text)) return "product_create";
  return null;
};

const isResetCommand = (message: string) =>
  /\b(reset|start over|new command|new request|clear state)\b/i.test(message);

const isCancelCommand = (message: string) =>
  /\b(cancel|stop|abort|never mind|nevermind)\b/i.test(message);

const parseInlinePrefill = (message: string, entityType: "task" | "sale" | "product" | "customer") => {
  const prefill: Record<string, unknown> = {};
  if (entityType === "task") {
    const title = extractValue(message, ["title is", "title"]);
    const description = extractValue(message, ["description is", "description"]);
    const status = extractValue(message, ["status is", "status"]);
    if (title) prefill.title = title;
    if (description) prefill.description = description;
    if (status) prefill.status = status;
  }
  if (entityType === "sale") {
    const product = extractValue(message, ["product is", "product"]);
    const quantity = parseNumber(message);
    if (product) prefill.productName = product;
    if (quantity && quantity > 0) prefill.quantity = quantity;
  }
  if (entityType === "product") {
    const name = extractValue(message, ["name is", "name"]);
    const description = extractValue(message, ["description is", "description"]);
    const price = parseNumber(extractValue(message, ["price is", "price"]) || message);
    const stock = parseNumber(extractValue(message, ["stock is", "stock"]) || "");
    const category = extractValue(message, ["category is", "category"]);
    const image = extractValue(message, ["image url is", "image url", "url"]);
    if (name) prefill.name = name;
    if (description) prefill.description = description;
    if (price !== null && price >= 0) prefill.price = price;
    if (stock !== null && stock >= 0) prefill.stock_quantity = Math.floor(stock);
    if (category) prefill.category = category;
    if (image) prefill.image_url = image;
  }
  if (entityType === "customer") {
    const name = extractValue(message, ["name is", "name"]);
    const email = extractValue(message, ["email is", "email"]);
    const phone = extractValue(message, ["phone is", "phone"]);
    if (name) prefill.name = name;
    if (email) prefill.email = email;
    if (phone) prefill.phone = phone;
  }
  return prefill;
};

const taskPromptForField = (field: string) => {
  if (field === "title") return "What should be the title of the task?";
  if (field === "description") return "What's the description?";
  if (field === "assignedTo") return "Who should this task be assigned to?";
  if (field === "status") return "Set status (Pending/In Progress/Completed)?";
  return "Please provide the next task detail.";
};

const salePromptForField = (field: string) => {
  if (field === "productName") return "Which product?";
  if (field === "quantity") return "Quantity?";
  return "Please provide the next sale detail.";
};

const productPromptForField = (field: string) => {
  if (field === "name") return "What is the product name?";
  if (field === "description") return "What is the product description?";
  if (field === "price") return "What is the price?";
  if (field === "stock_quantity") return "How many units are in stock?";
  if (field === "category") return "What is the category?";
  if (field === "image_url") return "What is the image URL?";
  return "Please provide the next product detail.";
};

const resolveAssignee = async (userId: string, message: string) => {
  const emailMatch = message.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (emailMatch) {
    const user = await User.findOne({ email: { $regex: `^${emailMatch[0]}$`, $options: "i" } })
      .select("_id")
      .lean();
    if (!user) return { ok: false as const, error: "I couldn't find that user email. Please enter a valid assignee email." };
    return { ok: true as const, assigneeId: user._id.toString() };
  }

  const labelValue = extractValue(message, ["assign to", "assigned to", "assignee"]);
  const name = labelValue || message.trim();
  if (!name) return { ok: false as const, error: "Please provide a user name or email." };
  if (/\bunassigned|none|no one\b/i.test(name)) return { ok: true as const, assigneeId: undefined };

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const user = await User.findOne({ name: { $regex: `^${escaped}$`, $options: "i" } })
    .select("_id")
    .lean();
  if (!user) return { ok: false as const, error: "I couldn't find that assignee. Please provide a valid user name or email." };
  return { ok: true as const, assigneeId: user._id.toString() };
};

const buildTaskCard = (task: any): AdminCard => ({
  type: "task",
  id: task._id.toString(),
  title: `Task #${task.task_number}: ${task.title}`,
  subtitle: String(task.status || "todo"),
  details: {
    title: task.title,
    description: task.description || "",
    assignedTo:
      typeof task.assignedTo === "object" && task.assignedTo
        ? `${task.assignedTo.name} (${task.assignedTo.email})`
        : "Unassigned",
    status: task.status,
  },
});

const buildSaleCard = (sale: any): AdminCard => ({
  type: "sale",
  id: sale._id.toString(),
  title: `Sale #${sale.saleNumber || sale.sale_number}`,
  subtitle: `$${Number(sale.total || 0).toFixed(2)}`,
  details: {
    product: sale.items?.[0]?.name,
    quantity: sale.items?.[0]?.quantity,
    total_price: sale.total,
    status: sale.status,
  },
});

const buildProductCard = (product: any): AdminCard => ({
  type: "product",
  id: product._id.toString(),
  title: product.name,
  subtitle: `$${Number(product.price).toFixed(2)} - Stock ${product.stock_quantity}`,
  details: {
    name: product.name,
    description: product.description,
    price: product.price,
    stock: product.stock_quantity,
    category: product.category,
    image: product.image_url,
  },
});

const isFollowUpCommand = (message: string) =>
  /\b(change|update|assign|show details|details|show last|last task|last sale|last product)\b/i.test(message);

const parseUpdateEntityType = (message: string): "task" | "sale" | "customer" | "product" | null => {
  const text = normalize(message);
  if (!/\b(update|edit|modify)\b/.test(text)) return null;
  if (/\btask\b/.test(text)) return "task";
  if (/\bsale\b/.test(text)) return "sale";
  if (/\bcustomer\b/.test(text)) return "customer";
  if (/\bproduct\b/.test(text)) return "product";
  return null;
};

const applyFollowUp = async (
  userId: string,
  message: string,
  state: ConversationState
): Promise<Pick<ConversationResponse, "answer" | "cards"> | null> => {
  if (!state.lastEntity) return null;
  const text = normalize(message);

  if (/\bshow details\b|\bshow last\b|\blast task\b|\blast sale\b|\blast product\b/.test(text)) {
    if (state.lastEntity.entityType === "task") {
      const card = buildTaskCard(state.lastEntity.data);
      return { answer: "Here are the details of the last task.", cards: [card] };
    }
    if (state.lastEntity.entityType === "sale") {
      const card = buildSaleCard(state.lastEntity.data);
      return { answer: "Here are the details of the last sale.", cards: [card] };
    }
    const card = buildProductCard(state.lastEntity.data);
    return { answer: "Here are the details of the last product.", cards: [card] };
  }

  if (state.lastEntity.entityType === "task") {
    const taskNumber = Number(state.lastEntity.entityNumber);
    if (!taskNumber) return null;
    if (text.includes("change title") || text.includes("update title")) {
      const title = extractValue(message, ["change title to", "update title to", "title"]);
      if (!title) return { answer: "Please provide the new title.", cards: [] };
      const updated = await taskService.updateTaskByNumber(userId, taskNumber, { title, _performedBy: "ai" });
      state.lastEntity = {
        entityType: "task",
        id: updated._id.toString(),
        entityNumber: updated.task_number,
        data: updated.toObject ? updated.toObject() : (updated as any),
      };
      return { answer: `Updated task title to "${title}".`, cards: [buildTaskCard(updated)] };
    }

    if (text.includes("description")) {
      const description = extractValue(message, ["change description to", "update description to", "description"]);
      if (!description) return { answer: "Please provide the new description.", cards: [] };
      const updated = await taskService.updateTaskByNumber(userId, taskNumber, { description, _performedBy: "ai" });
      state.lastEntity = {
        entityType: "task",
        id: updated._id.toString(),
        entityNumber: updated.task_number,
        data: updated.toObject ? updated.toObject() : (updated as any),
      };
      return { answer: "Description updated successfully.", cards: [buildTaskCard(updated)] };
    }

    if (text.includes("assign")) {
      const assignee = await resolveAssignee(userId, message);
      if (!assignee.ok) return { answer: assignee.error, cards: [] };
      const updated = await taskService.updateTaskByNumber(userId, taskNumber, {
        assignedTo: assignee.assigneeId || null,
        _performedBy: "ai",
      });
      state.lastEntity = {
        entityType: "task",
        id: updated._id.toString(),
        entityNumber: updated.task_number,
        data: updated.toObject ? updated.toObject() : (updated as any),
      };
      return { answer: "Task assignment updated.", cards: [buildTaskCard(updated)] };
    }
  }

  return null;
};

const completeTaskFlow = async (userId: string, state: ConversationState) => {
  const statusInput = normalize(String(state.data.status || "pending"));
  const status = TASK_STATUS_MAP[statusInput] || "todo";
  const created = await taskService.createTask(userId, {
    title: state.data.title,
    description: state.data.description || "",
    assignedTo: state.data.assignedTo,
    status,
    _performedBy: "ai",
  });
  const card = buildTaskCard(created);
  state.flow = null;
  state.pendingFields = [];
  state.data = {};
  state.lastFieldFilled = "status";
  state.lastEntity = {
    entityType: "task",
    id: created._id.toString(),
    entityNumber: created.task_number,
    data: created.toObject ? created.toObject() : (created as any),
  };

  const insight = await adminAiInsightsService.buildPostActionInsight(
    userId,
    "task",
    `Task created: ${created.title}`
  );
  return {
    answer: insight,
    cards: [card],
    proactiveActions: [
      "Review overdue tasks and close blockers.",
      "Assign owners for unassigned high-priority items.",
    ],
  };
};

const getOrCreateWalkInCustomer = async (userId: string) => {
  const existing = await Customer.findOne({ createdBy: new mongoose.Types.ObjectId(userId) })
    .sort({ createdAt: -1 })
    .select("_id")
    .lean();
  if (existing?._id) return existing._id.toString();

  const created = await Customer.create({
    name: "Walk-in Customer",
    email: "walkin@example.com",
    phone: "",
    address: "",
    createdBy: new mongoose.Types.ObjectId(userId),
  });
  return created._id.toString();
};

const completeSaleFlow = async (userId: string, storeId: string, state: ConversationState) => {
  const productName = String(state.data.productName || "");
  const quantity = Number(state.data.quantity || 0);
  let product = await Product.findOne({
    store_id: storeId,
    name: { $regex: productName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" },
  })
    .sort({ createdAt: -1 })
    .lean();

  if (!product && productName.trim()) {
    const candidates = await Product.find({ store_id: storeId })
      .select("name description price stock_quantity")
      .limit(80)
      .lean();
    const target = productName.trim().toLowerCase();
    const ranked = candidates
      .map((item) => ({
        item,
        score: levenshteinDistance(item.name.toLowerCase(), target),
      }))
      .sort((a, b) => a.score - b.score);
    if (ranked[0] && ranked[0].score <= 4) {
      product = ranked[0].item as any;
    }
  }

  if (!product) {
    return { error: "I couldn't find that product. Please enter an existing product name." };
  }
  if (quantity <= 0 || !Number.isFinite(quantity)) {
    return { error: "Quantity must be a valid number greater than 0." };
  }
  if (product.stock_quantity < quantity) {
    return { error: `Insufficient stock. Available stock for ${product.name} is ${product.stock_quantity}.` };
  }

  const customerId = await getOrCreateWalkInCustomer(userId);
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
  const refreshedProduct = await Product.findById(product._id).lean();
  const card = buildSaleCard(created);
  card.details.remaining_stock = refreshedProduct?.stock_quantity ?? product.stock_quantity - quantity;

  state.flow = null;
  state.pendingFields = [];
  state.data = {};
  state.lastFieldFilled = "quantity";
  state.lastEntity = {
    entityType: "sale",
    id: created._id.toString(),
    entityNumber: (created.saleNumber || created.sale_number) ?? undefined,
    data: created.toObject ? created.toObject() : (created as any),
  };

  const insight = await adminAiInsightsService.buildPostActionInsight(
    userId,
    "sale",
    `Sale created: ${product.name} x${quantity}`
  );
  return {
    answer: insight,
    cards: [card],
    proactiveActions: [
      "Follow up with top customers for repeat purchases.",
      "Compare conversion from this category over the last 30 days.",
    ],
  };
};

const completeProductFlow = async (userId: string, storeId: string, state: ConversationState) => {
  const price = Number(state.data.price);
  const stockQuantity = Number(state.data.stock_quantity);
  if (!Number.isFinite(price) || price < 0) {
    return { error: "Price must be a valid number." };
  }
  if (!Number.isFinite(stockQuantity) || stockQuantity < 0) {
    return { error: "Stock must be a valid number." };
  }

  const created = await Product.create({
    name: String(state.data.name || "").trim(),
    description: String(state.data.description || "").trim(),
    price,
    stock_quantity: stockQuantity,
    category: String(state.data.category || "General").trim() || "General",
    image_url: String(state.data.image_url || "").trim(),
    store_id: storeId,
    createdBy: new mongoose.Types.ObjectId(userId),
  });

  const card = buildProductCard(created);
  state.flow = null;
  state.pendingFields = [];
  state.data = {};
  state.lastFieldFilled = "image_url";
  state.lastEntity = {
    entityType: "product",
    id: created._id.toString(),
    data: created.toObject ? created.toObject() : (created as any),
  };

  const insight = await adminAiInsightsService.buildPostActionInsight(
    userId,
    "product",
    `Product created: ${created.name}`
  );
  return {
    answer: insight,
    cards: [card],
    proactiveActions: [
      "Promote this item in the store assistant recommendations.",
      "Watch inventory velocity for the first 7 days.",
    ],
  };
};

const collectField = async (userId: string, flow: FlowType, field: string, message: string) => {
  if (flow === "task_create") {
    if (field === "title") {
      const title = extractValue(message, ["title is", "title", "task title"]) || message.trim();
      if (!title) return { ok: false as const, error: "Task title is required." };
      return { ok: true as const, value: title };
    }
    if (field === "description") {
      const description = extractValue(message, ["description is", "description"]) || message.trim();
      if (!description) return { ok: false as const, error: "Description is required." };
      return { ok: true as const, value: description };
    }
    if (field === "assignedTo") {
      const assignee = await resolveAssignee(userId, message);
      if (!assignee.ok) return { ok: false as const, error: assignee.error };
      return { ok: true as const, value: assignee.assigneeId };
    }
    if (field === "status") {
      const statusText = extractValue(message, ["status is", "status"]) || message.trim();
      if (!statusText) return { ok: false as const, error: "Please provide status." };
      const mapped = TASK_STATUS_MAP[normalize(statusText)];
      if (!mapped) return { ok: false as const, error: "Status must be Pending, In Progress, Completed, or Blocked." };
      return { ok: true as const, value: statusText };
    }
  }

  if (flow === "sale_create") {
    if (field === "productName") {
      const productName = extractValue(message, ["product", "product is"]) || message.trim();
      if (!productName) return { ok: false as const, error: "Product name is required." };
      return { ok: true as const, value: productName };
    }
    if (field === "quantity") {
      const qty = parseNumber(message);
      if (!qty || qty <= 0) return { ok: false as const, error: "Quantity must be a number greater than 0." };
      return { ok: true as const, value: qty };
    }
  }

  if (flow === "product_create") {
    if (field === "name") {
      const name = extractValue(message, ["name", "product name"]) || message.trim();
      if (!name) return { ok: false as const, error: "Product name is required." };
      return { ok: true as const, value: name };
    }
    if (field === "description") {
      const description = extractValue(message, ["description"]) || message.trim();
      if (!description) return { ok: false as const, error: "Description is required." };
      return { ok: true as const, value: description };
    }
    if (field === "price") {
      const price = parseNumber(message);
      if (price === null || price < 0) return { ok: false as const, error: "Price must be a valid number." };
      return { ok: true as const, value: price };
    }
    if (field === "stock_quantity") {
      const stock = parseNumber(message);
      if (stock === null || stock < 0) return { ok: false as const, error: "Stock must be a valid non-negative number." };
      return { ok: true as const, value: Math.floor(stock) };
    }
    if (field === "category") {
      const category = extractValue(message, ["category"]) || message.trim();
      if (!category) return { ok: false as const, error: "Category is required." };
      return { ok: true as const, value: category };
    }
    if (field === "image_url") {
      const imageUrl = extractValue(message, ["image url", "image", "url"]) || message.trim();
      if (!/^https?:\/\/\S+/i.test(imageUrl)) {
        return { ok: false as const, error: "Please provide a valid image URL (http/https)." };
      }
      return { ok: true as const, value: imageUrl };
    }
  }

  return { ok: false as const, error: "I couldn't parse that input. Please try again." };
};

export const adminConversationalAiService = {
  resetSession(params: { userId: string; sessionId?: string }) {
    const key = getSessionKey(params.userId, params.sessionId);
    void writeState(params.userId, key, createDefaultState());
  },

  async handleMessage(params: {
    userId: string;
    sessionId?: string;
    message: string;
    storeId: string;
  }): Promise<ConversationResponse | null> {
    const { key, state } = await readState(params.userId, params.sessionId);

    if (isResetCommand(params.message)) {
      const nextState = createDefaultState();
      await writeState(params.userId, key, nextState);
      return {
        handled: true,
        answer: "Conversation reset. Start with a command like 'Create a task' or 'Edit sale #12'.",
        state: nextState,
      };
    }

    if (isCancelCommand(params.message)) {
      const nextState: ConversationState = { ...state, flow: null, pendingFields: [], data: {} };
      await writeState(params.userId, key, nextState);
      return {
        handled: true,
        answer: "Cancelled the current flow. You can start a new command now.",
        state: nextState,
      };
    }

    const flowFromMessage = startFlowFromMessage(params.message);

    if (state.flow && flowFromMessage) {
      state.flow = null;
      state.pendingFields = [];
      state.data = {};
      state.lastFieldFilled = undefined;
    }

    if (!state.flow && flowFromMessage) {
      state.flow = flowFromMessage;
      state.data = {};
      state.lastFieldFilled = undefined;
      state.pendingFields =
        flowFromMessage === "task_create"
          ? ["title", "description", "assignedTo", "status"]
          : flowFromMessage === "sale_create"
          ? ["productName", "quantity"]
          : ["name", "description", "price", "stock_quantity", "category", "image_url"];
      const entityType =
        flowFromMessage === "task_create"
          ? "task"
          : flowFromMessage === "sale_create"
          ? "sale"
          : "product";
      const prefill = parseInlinePrefill(params.message, entityType);
      if (Object.keys(prefill).length) {
        state.data = { ...prefill };
        state.pendingFields = state.pendingFields.filter((field) => typeof state.data[field] === "undefined");
      }
      await writeState(params.userId, key, state);
      const first = state.pendingFields[0] || "";
      const answer =
        flowFromMessage === "task_create"
          ? taskPromptForField(first)
          : flowFromMessage === "sale_create"
          ? salePromptForField(first)
          : productPromptForField(first);
      return {
        handled: true,
        answer,
        uiAction: {
          type: "open_form",
          entityType,
          mode: "create",
          prefill,
        },
        state,
      };
    }

    if (!state.flow && /\b(create|add|new)\b.*\bcustomer\b/i.test(normalize(params.message))) {
      const prefill = parseInlinePrefill(params.message, "customer");
      await writeState(params.userId, key, state);
      return {
        handled: true,
        answer: "Opening customer form. Fill required fields and submit.",
        uiAction: {
          type: "open_form",
          entityType: "customer",
          mode: "create",
          prefill,
        },
        state,
      };
    }

    if (!state.flow) {
      const updateEntityType = parseUpdateEntityType(params.message);
      if (updateEntityType) {
        const prefill =
          state.lastEntity?.entityType === updateEntityType ? { ...state.lastEntity.data } : {};
        await writeState(params.userId, key, state);
        return {
          handled: true,
          answer: `Opening ${updateEntityType} update form. Adjust fields and submit.`,
          uiAction: {
            type: "open_form",
            entityType: updateEntityType,
            mode: "update",
            prefill,
          },
          state,
        };
      }
    }

    if (!state.flow && isFollowUpCommand(params.message)) {
      const followUp = await applyFollowUp(params.userId, params.message, state);
      if (followUp) {
        await writeState(params.userId, key, state);
        return { handled: true, answer: followUp.answer, cards: followUp.cards, state };
      }
      return {
        handled: true,
        answer: "I don't have a recent entity in this session. Start with 'Create a task', 'Create a sale', or 'Add a product'.",
        state,
      };
    }

    if (!state.flow) return null;

    const currentField = state.pendingFields[0];
    if (!currentField) {
      state.flow = null;
      state.pendingFields = [];
      state.data = {};
      await writeState(params.userId, key, state);
      return {
        handled: true,
        answer: "That flow is complete. Start a new one with 'Create a task', 'Create a sale', or 'Add a product'.",
        state,
      };
    }

    const collected = await collectField(params.userId, state.flow, currentField, params.message);
    if (!collected.ok) {
      await writeState(params.userId, key, state);
      return { handled: true, answer: collected.error, state };
    }

    state.data[currentField] = collected.value;
    state.lastFieldFilled = currentField;
    state.pendingFields = state.pendingFields.slice(1);

    if (state.pendingFields.length > 0) {
      const nextField = state.pendingFields[0] || "";
      await writeState(params.userId, key, state);
      const answer =
        state.flow === "task_create"
          ? taskPromptForField(nextField)
          : state.flow === "sale_create"
          ? salePromptForField(nextField)
          : productPromptForField(nextField);
      return { handled: true, answer, state };
    }

    if (state.flow === "task_create") {
      const done = await completeTaskFlow(params.userId, state);
      await writeState(params.userId, key, state);
      return { handled: true, answer: done.answer, cards: done.cards, state, proactiveActions: done.proactiveActions };
    }

    if (state.flow === "sale_create") {
      const done = await completeSaleFlow(params.userId, params.storeId, state);
      if ("error" in done) {
        state.pendingFields = ["productName", "quantity"];
        await writeState(params.userId, key, state);
        return { handled: true, answer: done.error || "Please try again with valid sale details.", state };
      }
      await writeState(params.userId, key, state);
      return { handled: true, answer: done.answer, cards: done.cards, state, proactiveActions: done.proactiveActions };
    }

    const done = await completeProductFlow(params.userId, params.storeId, state);
    if ("error" in done) {
      state.pendingFields = ["price", "stock_quantity", "category", "image_url"];
      await writeState(params.userId, key, state);
      return { handled: true, answer: done.error || "Please provide valid product details.", state };
    }
    await writeState(params.userId, key, state);
    return { handled: true, answer: done.answer, cards: done.cards, state, proactiveActions: done.proactiveActions };
  },
};
