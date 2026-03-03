import mongoose from "mongoose";
import { AgentMemory } from "../models/agentMemory";

type StoredAdminSession = {
  lastEntityType?: "task" | "customer" | "sale" | "product";
  lastTask?: Record<string, unknown>;
  lastCustomer?: Record<string, unknown>;
  lastSale?: Record<string, unknown>;
  lastProduct?: Record<string, unknown>;
  pendingAction?: {
    type: "delete" | "history_delete";
    payload: Record<string, unknown>;
    createdAt: string;
  } | null;
  updatedAt: number;
};

const SESSION_KEY_PREFIX = "ai_admin_session:";
const EXPIRES_MS = 6 * 60 * 60 * 1000;

const toObjectId = (userId: string) => new mongoose.Types.ObjectId(userId);

const makeKey = (sessionKey: string) => `${SESSION_KEY_PREFIX}${sessionKey}`;

const defaultState = (): StoredAdminSession => ({
  updatedAt: Date.now(),
  pendingAction: null,
});

const parseState = (content?: string): StoredAdminSession => {
  if (!content) return defaultState();
  try {
    const parsed = JSON.parse(content) as StoredAdminSession;
    return { ...defaultState(), ...parsed, updatedAt: Date.now() };
  } catch {
    return defaultState();
  }
};

export const aiSessionStateService = {
  async getAdminSession(userId: string, sessionKey: string): Promise<StoredAdminSession> {
    const entry = await AgentMemory.findOne({
      userId: toObjectId(userId),
      type: "long_term",
      key: makeKey(sessionKey),
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }],
    })
      .sort({ updatedAt: -1 })
      .lean();

    return parseState(entry?.content);
  },

  async saveAdminSession(userId: string, sessionKey: string, state: StoredAdminSession) {
    const expiresAt = new Date(Date.now() + EXPIRES_MS);
    return AgentMemory.findOneAndUpdate(
      {
        userId: toObjectId(userId),
        type: "long_term",
        key: makeKey(sessionKey),
      },
      {
        $set: {
          content: JSON.stringify({ ...state, updatedAt: Date.now() }),
          metadata: { kind: "ai_admin_session" },
          expiresAt,
        },
      },
      { upsert: true, new: true }
    ).lean();
  },

  async savePendingAction(
    userId: string,
    sessionKey: string,
    action: { type: "delete" | "history_delete"; payload: Record<string, unknown> }
  ) {
    const current = await aiSessionStateService.getAdminSession(userId, sessionKey);
    current.pendingAction = {
      ...action,
      createdAt: new Date().toISOString(),
    };
    await aiSessionStateService.saveAdminSession(userId, sessionKey, current);
    return current.pendingAction;
  },

  async clearPendingAction(userId: string, sessionKey: string) {
    const current = await aiSessionStateService.getAdminSession(userId, sessionKey);
    current.pendingAction = null;
    await aiSessionStateService.saveAdminSession(userId, sessionKey, current);
  },
};

