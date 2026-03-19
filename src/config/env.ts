import dotenv from "dotenv";

dotenv.config();

const parseCsv = (value?: string) =>
  value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

const toNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const resolveDatabaseUrl = () => process.env.DATABASE_URL || process.env.MONGO_URI || "";

export const getMissingRequiredEnv = () => {
  const missing: string[] = [];

  if (!resolveDatabaseUrl()) missing.push("DATABASE_URL (or MONGO_URI)");
  if (!process.env.JWT_SECRET) missing.push("JWT_SECRET");
  if (!process.env.GEMINI_API_KEY) missing.push("GEMINI_API_KEY");
  if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");

  return missing;
};

export const assertRequiredEnv = () => {
  const missing = getMissingRequiredEnv();
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
};

export const env = {
  port: toNumber(process.env.PORT, 5000),
  databaseUrl: resolveDatabaseUrl(),
  jwtSecret: process.env.JWT_SECRET || "",
  clientUrl: process.env.CLIENT_URL || "",
  corsOrigins: parseCsv(process.env.CORS_ORIGINS),
  adminEmail: process.env.ADMIN_EMAIL || "",
  adminPassword: process.env.ADMIN_PASSWORD || "",
  adminName: process.env.ADMIN_NAME || "",
  demoStoreId: process.env.DEMO_STORE_ID || "demo-store-001",
  enableDemoSeed: process.env.ENABLE_DEMO_SEED === "true",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  geminiEmbeddingModel: process.env.GEMINI_EMBEDDING_MODEL || "text-embedding-004",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiChatModel: process.env.OPENAI_CHAT_MODEL || process.env.OPENAI_INTENT_MODEL || "gpt-4o-mini",
  openaiIntentModel: process.env.OPENAI_INTENT_MODEL || "gpt-4o-mini",
  openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
  aiLocalUrl: process.env.AI_LOCAL_URL || "",
  dbPoolSize: toNumber(process.env.DB_POOL_SIZE, 10),
  dbServerSelectionTimeoutMs: toNumber(process.env.DB_SERVER_SELECTION_TIMEOUT_MS, 10000),
};
