import { describe, expect, it } from "vitest";

import { ALLOWED_IMAGE_TYPES, chatRequestSchema } from "@/lib/chat/schema";
import {
  DEFAULT_REASONING_EFFORT,
  REASONING_EFFORTS,
  resolveKimiConfig,
} from "@/lib/kimi/config";
import { describeProviderError, sanitizeProviderText } from "@/lib/kimi/errors";
import { buildKimiRequest, userContentWithImages } from "@/lib/kimi/request";
import { createSseParser, normalizeUsage, parseCompletionChunk } from "@/lib/kimi/sse";

function config(env: Parameters<typeof resolveKimiConfig>[0]) {
  const r = resolveKimiConfig(env);
  if (!r.ok) throw new Error(`config not ok: ${[...r.missing, ...r.invalid].join(",")}`);
  return r.config;
}

describe("provider configuration", () => {
  it("variant A: official Moonshot API uses model kimi-k3.1-pro", () => {
    const c = config({ KIMI_API_KEY: "k", KIMI_API_BASE_URL: "https://api.moonshot.ai/v1" });
    expect(c.provider).toBe("moonshot");
    expect(c.modelId).toBe("kimi-k3.1-pro");
  });

  it("variant B: kineticRouter uses model moonshot/kimi-k3.1-pro", () => {
    const c = config({ KIMI_API_KEY: "k", KIMI_API_BASE_URL: "https://api.kineticrouter.com/v1" });
    expect(c.provider).toBe("kineticrouter");
    expect(c.modelId).toBe("moonshot/kimi-k3.1-pro");
  });

  it("an explicit KIMI_MODEL_ID is used as given", () => {
    const c = config({
      KIMI_API_KEY: "k",
      KIMI_API_BASE_URL: "https://api.kineticrouter.com/v1/",
      KIMI_MODEL_ID: "moonshot/kimi-k3.1-pro",
    });
    expect(c.modelId).toBe("moonshot/kimi-k3.1-pro");
    expect(c.baseUrl).toBe("https://api.kineticrouter.com/v1");
  });

  it("reports a missing API key instead of guessing", () => {
    const r = resolveKimiConfig({ KIMI_API_BASE_URL: "https://api.moonshot.ai/v1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain("KIMI_API_KEY");
  });
});

describe("request to Kimi", () => {
  const c = config({
    KIMI_API_KEY: "secret-key-123456",
    KIMI_API_BASE_URL: "https://api.moonshot.ai/v1",
    KIMI_MODEL_ID: "kimi-k3.1-pro",
  });

  it("posts to {KIMI_API_BASE_URL}/chat/completions with a Bearer key", () => {
    const req = buildKimiRequest(c, [{ role: "user", content: "hi" }], "high", true);
    expect(req.url).toBe("https://api.moonshot.ai/v1/chat/completions");
    expect(req.headers["Authorization"]).toBe("Bearer secret-key-123456");
  });

  it("always sends the configured Kimi model and the chosen reasoning_effort", () => {
    for (const effort of REASONING_EFFORTS) {
      const req = buildKimiRequest(c, [{ role: "user", content: "hi" }], effort, false);
      expect(req.body["model"]).toBe("kimi-k3.1-pro");
      expect(req.body["reasoning_effort"]).toBe(effort);
    }
  });

  it("sends images as a content array with image_url parts", () => {
    const content = userContentWithImages("что на фото?", ["data:image/png;base64,AAA"]);
    expect(content).toEqual([
      { type: "text", text: "что на фото?" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
    ]);
  });
});

describe("reasoning effort", () => {
  it("offers exactly Low, High and Max", () => {
    expect([...REASONING_EFFORTS]).toEqual(["low", "high", "max"]);
  });

  it("defaults to High", () => {
    expect(DEFAULT_REASONING_EFFORT).toBe("high");
  });

  it("rejects any other level in a chat request", () => {
    const base = {
      conversationId: "11111111-1111-4111-8111-111111111111",
      userMessageId: "22222222-2222-4222-8222-222222222222",
      assistantMessageId: "33333333-3333-4333-8333-333333333333",
      content: "hi",
      attachments: [],
    };
    expect(chatRequestSchema.safeParse({ ...base, reasoningEffort: "medium" }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...base, reasoningEffort: "max" }).success).toBe(true);
  });
});

describe("images", () => {
  it("accepts only PNG, JPG/JPEG and WebP", () => {
    expect([...ALLOWED_IMAGE_TYPES].sort()).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });
});

describe("error messages", () => {
  it("401 is an API key problem", () => {
    const e = describeProviderError(401);
    expect(e.code).toBe("invalid_api_key");
    expect(e.title).toContain("401");
  });

  it("403 is no access to the model", () => {
    expect(describeProviderError(403).code).toBe("model_forbidden");
  });

  it("404 is a wrong model id or endpoint", () => {
    expect(describeProviderError(404).code).toBe("not_found");
  });

  it("429 is a rate limit and carries the retry delay", () => {
    const e = describeProviderError(429, undefined, 12);
    expect(e.code).toBe("provider_rate_limited");
    expect(e.retryAfter).toBe(12);
  });

  it("500, 502 and 503 are provider service errors", () => {
    for (const status of [500, 502, 503]) {
      const e = describeProviderError(status);
      expect(e.code).toBe("provider_unavailable");
      expect(e.title).toContain(String(status));
    }
  });

  it("never shows the API key in an error", () => {
    const key = "sk-live-abcdef1234567890";
    const text = sanitizeProviderText(`Incorrect API key provided: ${key}. Authorization: Bearer ${key}`, [key]);
    expect(text).not.toContain(key);
    expect(text).not.toContain("abcdef1234567890");
  });
});

describe("stream handling", () => {
  it("keeps the answer and drops reasoning_content", () => {
    const thinking = parseCompletionChunk({
      choices: [{ delta: { reasoning_content: "secret chain of thought" } }],
    });
    expect(thinking.content).toBe("");
    expect(thinking.hasReasoning).toBe(true);
    expect(JSON.stringify(thinking)).not.toContain("secret chain of thought");

    const answer = parseCompletionChunk({ choices: [{ delta: { content: "Привет" }, finish_reason: "stop" }] });
    expect(answer.content).toBe("Привет");
    expect(answer.finishReason).toBe("stop");
  });

  it("reassembles SSE events split across network chunks", () => {
    const events: string[] = [];
    const parser = createSseParser((d) => events.push(d));
    parser.feed('data: {"a":');
    parser.feed('1}\n\ndata: {"b":2}\r\n\r\n: ping\n\ndata: [DO');
    parser.feed("NE]\n\n");
    parser.end();
    expect(events).toEqual(['{"a":1}', '{"b":2}', "[DONE]"]);
  });
});

describe("token usage", () => {
  it("reports exactly what the API returned", () => {
    expect(
      normalizeUsage({
        prompt_tokens: 120,
        completion_tokens: 45,
        total_tokens: 165,
        completion_tokens_details: { reasoning_tokens: 30 },
      }),
    ).toEqual({ prompt_tokens: 120, completion_tokens: 45, reasoning_tokens: 30, total_tokens: 165 });
  });

  it("reads usage that Moonshot puts inside the final choice", () => {
    const info = parseCompletionChunk({
      choices: [{ delta: {}, finish_reason: "stop", usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } }],
    });
    expect(info.usage?.prompt_tokens).toBe(7);
    expect(info.usage?.completion_tokens).toBe(3);
  });

  it("shows nothing rather than inventing numbers when usage is absent", () => {
    expect(normalizeUsage(undefined)).toBeNull();
    expect(normalizeUsage({})).toBeNull();
  });
});
