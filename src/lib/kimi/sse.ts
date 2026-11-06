/**
 * Minimal Server-Sent Events framing parser (shared by server and browser).
 * Feed it decoded text chunks; it calls onData for every complete `data:` payload.
 */
export function createSseParser(onData: (data: string) => void) {
  let buffer = "";
  let dataLines: string[] = [];

  const dispatch = () => {
    if (dataLines.length > 0) {
      onData(dataLines.join("\n"));
      dataLines = [];
    }
  };

  const processLine = (rawLine: string) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") {
      dispatch();
      return;
    }
    if (line.startsWith(":")) return; // comment / keep-alive
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") dataLines.push(value);
  };

  return {
    feed(text: string) {
      buffer += text;
      let index: number;
      while ((index = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        processLine(line);
      }
    },
    /** Flush any trailing event when the stream ends without a blank line. */
    end() {
      if (buffer.length > 0) {
        processLine(buffer);
        buffer = "";
      }
      dispatch();
    },
  };
}

export interface Usage {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Normalizes an OpenAI-compatible `usage` object. Returns null when nothing usable is present. */
export function normalizeUsage(raw: unknown): Usage | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  const details = (u["completion_tokens_details"] ?? {}) as Record<string, unknown>;
  const usage: Usage = {
    prompt_tokens: num(u["prompt_tokens"] ?? u["input_tokens"]),
    completion_tokens: num(u["completion_tokens"] ?? u["output_tokens"]),
    reasoning_tokens: num(details["reasoning_tokens"] ?? u["reasoning_tokens"]),
    total_tokens: num(u["total_tokens"]),
  };
  if (
    usage.prompt_tokens === null &&
    usage.completion_tokens === null &&
    usage.total_tokens === null
  ) {
    return null;
  }
  return usage;
}

export interface ChunkInfo {
  /** Visible answer text in this chunk. */
  content: string;
  /** True when the chunk carried hidden reasoning (never forwarded to the UI). */
  hasReasoning: boolean;
  usage: Usage | null;
  finishReason: string | null;
  /** Error object embedded in the stream, if any. */
  errorMessage: string | null;
}

/**
 * Extracts the parts of an OpenAI-compatible chat.completion.chunk we care about.
 * `reasoning_content` is detected but intentionally dropped.
 */
export function parseCompletionChunk(json: unknown): ChunkInfo {
  const info: ChunkInfo = {
    content: "",
    hasReasoning: false,
    usage: null,
    finishReason: null,
    errorMessage: null,
  };
  if (!json || typeof json !== "object") return info;
  const obj = json as Record<string, unknown>;

  const err = obj["error"];
  if (err) {
    info.errorMessage =
      typeof err === "string"
        ? err
        : typeof (err as Record<string, unknown>)["message"] === "string"
          ? ((err as Record<string, unknown>)["message"] as string)
          : "stream error";
  }

  info.usage = normalizeUsage(obj["usage"]);

  const choices = Array.isArray(obj["choices"]) ? (obj["choices"] as unknown[]) : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== "object") continue;
    const c = choice as Record<string, unknown>;
    const delta = (c["delta"] ?? c["message"] ?? {}) as Record<string, unknown>;
    if (typeof delta["content"] === "string") info.content += delta["content"];
    const reasoning = delta["reasoning_content"] ?? delta["reasoning"];
    if (typeof reasoning === "string" && reasoning.length > 0) info.hasReasoning = true;
    if (typeof c["finish_reason"] === "string") info.finishReason = c["finish_reason"];
    // Moonshot reports usage inside the final choice.
    if (!info.usage) info.usage = normalizeUsage(c["usage"]);
  }
  return info;
}

/** Events sent from this app's /api/chat endpoint to the browser. */
export type ChatStreamEvent =
  | {
      type: "start";
      conversationId: string;
      userMessageId: string;
      assistantMessageId: string;
      model: string;
      provider: string;
      mode: "stream" | "full";
    }
  | { type: "phase"; phase: "thinking" | "answering" }
  | { type: "delta"; text: string }
  | { type: "usage"; usage: Usage }
  | {
      type: "done";
      finishReason: string | null;
      usage: Usage | null;
      assistantMessage: unknown;
      saved: boolean;
    }
  | { type: "error"; error: import("./errors").ChatError };
