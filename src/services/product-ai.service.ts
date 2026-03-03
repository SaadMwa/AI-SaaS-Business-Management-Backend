import { env } from "../config/env";

const geminiGenerate = async (prompt: string, temperature = 0.5, maxOutputTokens = 300) => {
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
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

export const productAiService = {
  async generateDescription(params: {
    name: string;
    category?: string;
    price?: number;
    keywords?: string;
  }) {
    const prompt = [
      "Write a premium ecommerce product description in 2 short paragraphs.",
      "Tone: trustworthy, modern, conversion-focused.",
      "No emojis, no markdown, no exaggerated claims.",
      `Product: ${params.name}`,
      `Category: ${params.category || "General"}`,
      typeof params.price === "number" ? `Price point: $${params.price.toFixed(2)}` : "",
      params.keywords ? `Keywords: ${params.keywords}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return (
      (await geminiGenerate(prompt, 0.55, 280)) ||
      `${params.name} is a reliable ${params.category || "general"} product designed for daily use. It balances quality, usability, and value.\n\nBuilt for customers who want dependable performance, this product is an excellent fit for both new and returning buyers.`
    );
  },

  async generateMarketingCaption(params: {
    name: string;
    category?: string;
    price?: number;
    description?: string;
  }) {
    const prompt = [
      "Generate 3 short marketing captions for a SaaS-powered online store product card.",
      "Each caption must be under 14 words and high-conversion.",
      "Return plain text with one caption per line and no numbering.",
      `Product: ${params.name}`,
      `Category: ${params.category || "General"}`,
      typeof params.price === "number" ? `Price: $${params.price.toFixed(2)}` : "",
      params.description ? `Description: ${params.description}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return (
      (await geminiGenerate(prompt, 0.7, 180)) ||
      [
        `Upgrade your setup with ${params.name}.`,
        `Smart value, modern performance, built for everyday wins.`,
        `Grab ${params.name} now before stock drops.`,
      ].join("\n")
    );
  },
};
