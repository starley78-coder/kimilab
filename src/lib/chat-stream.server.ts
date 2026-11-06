/**
 * Server-only chat handler: authenticates the caller, enforces access and rate limits,
 * persists the user message, calls Kimi (streaming with a full-response fallback),
 * forwards only the visible answer to the browser and saves the reply with real usage.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  IMAGE_BUCKET,
  chatRequestSchema,
  parseStoredAttachments,
  type ChatRequestBody,
} from "@/lib/chat/schema";
import { chatCompletionsUrl, resolveKimiConfig, type KimiConfig } from "@/lib/kimi/config";
import {
  appError,
  connectionError,
  describeProviderError,
  extractProviderMessage,
  rateLimitedError,
  sanitizeProviderText,
  type ChatError,
} from "@/lib/kimi/errors";
import {
  createSseParser,
  parseCompletionChunk,
  type ChatStreamEvent,
  type Usage,
} from "@/lib/kimi/sse";

type DB = SupabaseClient<Database>;

const MAX_HISTORY_MESSAGES = 80;
const MAX_INLINE_IMAGES = 6;
const MAX_IMAGE_TURNS = 3;
const PING_INTERVAL_MS = 15_000;

const encoder = new TextEncoder();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function errorResponse(error: ChatError): Response {
  const httpStatus = error.source === "app" ? error.status || 500 : 502;
  return jsonResponse(httpStatus, { error });
}

function createUserClient(url: string, key: string, token: string): DB {
  return createClient<Database>(url, key, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

type ApiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type ApiMessage =
  | { role: "user"; content: string | ApiContentPart[] }
  | { role: "assistant"; content: string };

interface HistoryRow {
  id: string;
  role: string;
  content: string;
  attachments: unknown;
}

async function buildApiMessages(supabase: DB, history: HistoryRow[]): Promise<ApiMessage[]> {
  // Decide which images to inline: the most recent image turns only.
  const inlinePaths = new Set<string>();
  let imageTurns = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const row = history[i];
    if (!row || row.role !== "user") continue;
    const atts = parseStoredAttachments(row.attachments);
    if (!atts.length) continue;
    if (imageTurns >= MAX_IMAGE_TURNS) break;
    imageTurns++;
    for (const att of atts) {
      if (inlinePaths.size >= MAX_INLINE_IMAGES) break;
      inlinePaths.add(att.path);
    }
  }

  const dataUrls = new Map<string, string>();
  await Promise.all(
    [...inlinePaths].map(async (path) => {
      const { data, error } = await supabase.storage.from(IMAGE_BUCKET).download(path);
      if (error || !data) return;
      const bytes = new Uint8Array(await data.arrayBuffer());
      const type = data.type && data.type.startsWith("image/") ? data.type : "image/jpeg";
      dataUrls.set(path, `data:${type};base64,${toBase64(bytes)}`);
    }),
  );

  const messages: ApiMessage[] = [];
  for (const row of history) {
    if (row.role === "assistant") {
      if (row.content.trim()) messages.push({ role: "assistant", content: row.content });
      continue;
    }
    const atts = parseStoredAttachments(row.attachments);
    if (!atts.length) {
      messages.push({ role: "user", content: row.content });
      continue;
    }
    const parts: ApiContentPart[] = [];
    const notes: string[] = [];
    for (const att of atts) {
      const url = dataUrls.get(att.path);
      if (url) parts.push({ type: "image_url", image_url: { url } });
      else notes.push(`[image not re-sent: ${att.name}]`);
    }
    const text = [row.content, ...notes].filter((s) => s.trim()).join("\n");
    if (text) parts.unshift({ type: "text", text });
    messages.push({ role: "user", content: parts.length ? parts : row.content });
  }
  return messages;
}

function callKimi(
  config: KimiConfig,
  messages: ApiMessage[],
  effort: ChatRequestBody["reasoningEffort"],
  stream: boolean,
  signal: AbortSignal,
): Promise<Response> {
  const payload: Record<string, unknown> = {
    model: config.modelId,
    messages,
    reasoning_effort: effort,
    max_tokens: config.maxTokens,
    stream,
  };
  if (stream) payload["stream_options"] = { include_usage: true };
  return fetch(chatCompletionsUrl(config), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: stream ? "text/event-stream" : "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });
}

function retryAfterSeconds(res: Response): number | undefined {
  const raw = res.headers.get("retry-after");
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

async function providerFailure(res: Response, secret: string): Promise<ChatError> {
  const body = await res.text().catch(() => "");
  const detail = sanitizeProviderText(extractProviderMessage(body), [secret]);
  return describeProviderError(res.status, detail, retryAfterSeconds(res));
}

function errorDetail(e: unknown, secret: string): string {
  const msg = e instanceof Error ? e.message : String(e);
  return sanitizeProviderText(msg, [secret]);
}

export async function handleChatRequest(request: Request): Promise<Response> {
  const supabaseUrl = process.env["SUPABASE_URL"];
  const supabaseKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!supabaseUrl || !supabaseKey) {
    return errorResponse(
      appError(500, "backend_not_configured", "Сервер не настроен", "Не найдены настройки базы данных."),
    );
  }

  // 1. Authenticate
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token || token.split(".").length !== 3) {
    return errorResponse(appError(401, "unauthorized", "Требуется вход", "Сессия не найдена. Войдите заново."));
  }
  const supabase = createUserClient(supabaseUrl, supabaseKey, token);
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
  const userId = claimsData?.claims?.sub;
  if (claimsError || !userId) {
    return errorResponse(appError(401, "unauthorized", "Сессия истекла", "Войдите заново, чтобы продолжить."));
  }

  // 2. Validate input
  let body: ChatRequestBody;
  try {
    const parsed = chatRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorResponse(
        appError(400, "invalid_request", "Некорректный запрос", parsed.error.issues[0]?.message ?? "Проверьте данные."),
      );
    }
    body = parsed.data;
  } catch {
    return errorResponse(appError(400, "invalid_request", "Некорректный запрос", "Тело запроса не является JSON."));
  }
  if (body.attachments.some((a) => !a.path.startsWith(`${userId}/${body.conversationId}/`))) {
    return errorResponse(appError(400, "invalid_attachment", "Некорректное вложение", "Изображение не принадлежит диалогу."));
  }

  // 3. Workspace access (personal app: owner only)
  const { data: access, error: accessError } = await supabase.rpc("claim_workspace_access");
  if (accessError) {
    console.error("[chat] access check failed", accessError.message);
    return errorResponse(appError(500, "access_check_failed", "Ошибка проверки доступа", "Не удалось проверить доступ."));
  }
  if (!(access as { has_access?: boolean } | null)?.has_access) {
    return errorResponse(
      appError(403, "no_workspace_access", "Нет доступа", "Это персональное пространство другого пользователя."),
    );
  }

  // 4. Provider configuration (server secrets)
  const resolved = resolveKimiConfig({
    KIMI_API_KEY: process.env["KIMI_API_KEY"],
    KIMI_API_BASE_URL: process.env["KIMI_API_BASE_URL"],
    KIMI_MODEL_ID: process.env["KIMI_MODEL_ID"],
    KIMI_MAX_TOKENS: process.env["KIMI_MAX_TOKENS"],
  });
  if (!resolved.ok) {
    const names = [...resolved.missing, ...resolved.invalid].join(", ");
    return errorResponse(
      appError(
        503,
        "not_configured",
        "Kimi API не настроен",
        `Добавьте или исправьте серверные секреты: ${names}.`,
      ),
    );
  }
  const config = resolved.config;

  // 5. Conversation must belong to the caller (RLS)
  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", body.conversationId)
    .maybeSingle();
  if (convError || !conversation) {
    return errorResponse(appError(404, "conversation_not_found", "Диалог не найден", "Диалог удалён или недоступен."));
  }

  // 6. Server-side rate limit
  const { data: quota, error: quotaError } = await supabase.rpc("consume_chat_quota");
  if (quotaError) {
    console.error("[chat] quota check failed", quotaError.message);
    return errorResponse(appError(500, "quota_check_failed", "Ошибка лимита", "Не удалось проверить лимит запросов."));
  }
  const q = quota as { allowed?: boolean; retry_after?: number; scope?: "minute" | "day"; limit?: number } | null;
  if (!q?.allowed) {
    return errorResponse(rateLimitedError(q?.retry_after ?? 60, q?.scope ?? "minute", q?.limit ?? 0));
  }

  // 7. Persist the user message (idempotent for retries)
  const { error: userInsertError } = await supabase.from("messages").upsert(
    {
      id: body.userMessageId,
      conversation_id: body.conversationId,
      user_id: userId,
      role: "user",
      content: body.content,
      attachments: body.attachments,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (userInsertError) {
    console.error("[chat] user message insert failed", userInsertError.message);
    return errorResponse(appError(500, "save_failed", "Не удалось сохранить сообщение", "Повторите попытку."));
  }

  // 8. Load history up to and including this user message
  const { data: rows, error: historyError } = await supabase
    .from("messages")
    .select("id, role, content, attachments, seq")
    .eq("conversation_id", body.conversationId)
    .order("seq", { ascending: false })
    .limit(MAX_HISTORY_MESSAGES);
  if (historyError || !rows) {
    return errorResponse(appError(500, "history_failed", "Ошибка истории", "Не удалось загрузить историю диалога."));
  }
  let history: HistoryRow[] = [...rows].reverse();
  const idx = history.findIndex((r) => r.id === body.userMessageId);
  if (idx >= 0) history = history.slice(0, idx + 1);
  while (history.length && history[0]?.role !== "user") history.shift();

  let apiMessages: ApiMessage[];
  try {
    apiMessages = await buildApiMessages(supabase, history);
  } catch (e) {
    console.error("[chat] build messages failed", e);
    return errorResponse(appError(500, "attachments_failed", "Ошибка вложений", "Не удалось подготовить изображения."));
  }

  // 9. Call Kimi
  const upstreamAbort = new AbortController();
  request.signal?.addEventListener("abort", () => upstreamAbort.abort(), { once: true });

  let mode: "stream" | "full" = "stream";
  let upstream: Response;
  try {
    upstream = await callKimi(config, apiMessages, body.reasoningEffort, true, upstreamAbort.signal);
  } catch (e) {
    return errorResponse(connectionError(errorDetail(e, config.apiKey)));
  }
  if (!upstream.ok) {
    const failure = await providerFailure(upstream, config.apiKey);
    const streamUnsupported = upstream.status === 400 && /stream/i.test(failure.detail ?? "");
    if (!streamUnsupported) return errorResponse(failure);
    mode = "full";
    try {
      upstream = await callKimi(config, apiMessages, body.reasoningEffort, false, upstreamAbort.signal);
    } catch (e) {
      return errorResponse(connectionError(errorDetail(e, config.apiKey)));
    }
    if (!upstream.ok) return errorResponse(await providerFailure(upstream, config.apiKey));
  }
  const contentType = upstream.headers.get("content-type") ?? "";
  if (mode === "stream" && !contentType.includes("text/event-stream")) mode = "full";

  const saveAssistant = async (
    content: string,
    status: "complete" | "stopped",
    usage: Usage | null,
    finishReason: string | null,
  ) => {
    const { data, error } = await supabase
      .from("messages")
      .upsert(
        {
          id: body.assistantMessageId,
          conversation_id: body.conversationId,
          user_id: userId,
          role: "assistant",
          content,
          status,
          model: config.modelId,
          reasoning_effort: body.reasoningEffort,
          finish_reason: finishReason,
          prompt_tokens: usage?.prompt_tokens ?? null,
          completion_tokens: usage?.completion_tokens ?? null,
          reasoning_tokens: usage?.reasoning_tokens ?? null,
          total_tokens: usage?.total_tokens ?? null,
        },
        { onConflict: "id", ignoreDuplicates: true },
      )
      .select()
      .maybeSingle();
    if (error) console.error("[chat] assistant save failed", error.message);
    return { row: data, error };
  };

  const responseBody = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: ChatStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const ping = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          closed = true;
        }
      }, PING_INTERVAL_MS);
      const finish = () => {
        clearInterval(ping);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      };

      send({
        type: "start",
        conversationId: body.conversationId,
        userMessageId: body.userMessageId,
        assistantMessageId: body.assistantMessageId,
        model: config.modelId,
        provider: config.providerLabel,
        mode,
      });

      let text = "";
      let usage: Usage | null = null;
      let finishReason: string | null = null;
      let phase: "thinking" | "answering" | null = null;
      let streamError: ChatError | null = null;

      try {
        if (mode === "full") {
          const raw = (await upstream.json()) as unknown;
          const info = parseCompletionChunk(raw);
          if (info.errorMessage) {
            streamError = describeProviderError(502, sanitizeProviderText(info.errorMessage, [config.apiKey]));
          }
          text = info.content;
          usage = info.usage;
          finishReason = info.finishReason;
          send({ type: "phase", phase: "answering" });
          if (text) send({ type: "delta", text });
        } else {
          const reader = upstream.body!.getReader();
          const decoder = new TextDecoder();
          const parser = createSseParser((data) => {
            if (data === "[DONE]") return;
            let json: unknown;
            try {
              json = JSON.parse(data);
            } catch {
              return;
            }
            const info = parseCompletionChunk(json);
            if (info.errorMessage) {
              streamError = describeProviderError(502, sanitizeProviderText(info.errorMessage, [config.apiKey]));
              return;
            }
            if (info.hasReasoning && phase === null) {
              phase = "thinking";
              send({ type: "phase", phase });
            }
            if (info.content) {
              if (phase !== "answering") {
                phase = "answering";
                send({ type: "phase", phase });
              }
              text += info.content;
              send({ type: "delta", text: info.content });
            }
            if (info.usage) usage = info.usage;
            if (info.finishReason) finishReason = info.finishReason;
          });
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            parser.feed(decoder.decode(value, { stream: true }));
            if (streamError) {
              await reader.cancel().catch(() => undefined);
              break;
            }
          }
          parser.feed(decoder.decode());
          parser.end();
        }
      } catch (e) {
        if (upstreamAbort.signal.aborted) {
          // The browser stopped the generation: keep what was produced so far.
          if (text) await saveAssistant(text, "stopped", usage, "stopped");
          finish();
          return;
        }
        streamError = connectionError(errorDetail(e, config.apiKey));
      }

      if (usage) send({ type: "usage", usage });

      if (streamError && !text) {
        send({ type: "error", error: streamError });
        finish();
        return;
      }

      const status = streamError ? "stopped" : "complete";
      const { row, error } = await saveAssistant(text, status, usage, finishReason);
      send({ type: "done", finishReason, usage, assistantMessage: row, saved: !error });
      if (streamError) send({ type: "error", error: streamError });
      else if (error) {
        send({
          type: "error",
          error: appError(500, "save_failed", "Ответ не сохранён", "Ответ получен, но не записан в историю."),
        });
      }
      finish();
    },
    cancel() {
      upstreamAbort.abort();
    },
  });

  return new Response(responseBody, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
