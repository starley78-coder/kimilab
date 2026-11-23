import { chatCompletionsUrl, type KimiConfig, type ReasoningEffort } from "@/lib/kimi/config";

export type ApiContentPart =
  { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export type ApiMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ApiContentPart[] }
  | { role: "assistant"; content: string };

/**
 * Resolves the system instruction for a turn: the conversation's own instruction wins
 * (an empty string there means "none"), otherwise the owner's default is used.
 */
export function resolveSystemPrompt(
  conversationPrompt: string | null | undefined,
  defaultPrompt: string | null | undefined,
): string {
  if (conversationPrompt !== null && conversationPrompt !== undefined)
    return conversationPrompt.trim();
  return (defaultPrompt ?? "").trim();
}

/** Puts the system instruction first; no system message when it is empty. */
export function withSystemPrompt(messages: ApiMessage[], prompt: string): ApiMessage[] {
  const rest = messages.filter((m) => m.role !== "system");
  return prompt.trim() ? [{ role: "system", content: prompt.trim() }, ...rest] : rest;
}

export interface KimiHttpRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/**
 * Builds the exact POST {KIMI_API_BASE_URL}/chat/completions request.
 * The model is always the configured Kimi model — there is no fallback model.
 */
export function buildKimiRequest(
  config: Pick<KimiConfig, "apiKey" | "baseUrl" | "modelId" | "maxTokens">,
  messages: ApiMessage[],
  effort: ReasoningEffort,
  stream: boolean,
  extra?: Record<string, unknown>,
): KimiHttpRequest {
  const body: Record<string, unknown> = {
    model: config.modelId,
    messages,
    reasoning_effort: effort,
    max_tokens: config.maxTokens,
    stream,
  };
  if (stream) body["stream_options"] = { include_usage: true };
  if (extra) Object.assign(body, extra);
  return {
    url: chatCompletionsUrl(config),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: stream ? "text/event-stream" : "application/json",
    },
    body,
  };
}

/** A user turn with images, in the OpenAI-compatible content-array format. */
export function userContentWithImages(
  text: string,
  imageUrls: string[],
): string | ApiContentPart[] {
  if (imageUrls.length === 0) return text;
  const parts: ApiContentPart[] = [];
  if (text.trim()) parts.push({ type: "text", text });
  for (const url of imageUrls) parts.push({ type: "image_url", image_url: { url } });
  return parts;
}
