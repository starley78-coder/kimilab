import { supabase } from "@/integrations/supabase/client";
import type { ChatRequestBody } from "@/lib/chat/schema";
import { appError, isChatError, type ChatError } from "@/lib/kimi/errors";
import { createSseParser, type ChatStreamEvent } from "@/lib/kimi/sse";

export class StreamAbortedError extends Error {
  constructor() {
    super("aborted");
    this.name = "StreamAbortedError";
  }
}

function networkError(): ChatError {
  return {
    source: "network",
    status: 0,
    code: "app_unreachable",
    title: "Нет соединения",
    message: "Не удалось связаться с сервером приложения. Проверьте интернет и повторите.",
  };
}

/**
 * POSTs to the app's /api/chat endpoint and streams back typed events.
 * Throws StreamAbortedError when the caller aborts.
 */
export async function streamChat(
  body: ChatRequestBody,
  opts: { signal: AbortSignal; onEvent: (event: ChatStreamEvent) => void },
): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    opts.onEvent({
      type: "error",
      error: appError(401, "unauthorized", "Требуется вход", "Сессия истекла. Войдите заново."),
    });
    return;
  }

  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch {
    if (opts.signal.aborted) throw new StreamAbortedError();
    opts.onEvent({ type: "error", error: networkError() });
    return;
  }

  if (!res.ok || !res.body) {
    let error: ChatError | null = null;
    try {
      const json = (await res.json()) as { error?: unknown };
      if (isChatError(json.error)) error = json.error;
    } catch {
      // non-JSON error body
    }
    opts.onEvent({
      type: "error",
      error:
        error ??
        appError(res.status, "app_error", `${res.status} — ошибка приложения`, "Сервер приложения вернул ошибку."),
    });
    return;
  }

  let finished = false;
  const parser = createSseParser((payload) => {
    try {
      const event = JSON.parse(payload) as ChatStreamEvent;
      if (event.type === "done" || event.type === "error") finished = true;
      opts.onEvent(event);
    } catch {
      // ignore malformed event
    }
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
    }
    parser.feed(decoder.decode());
    parser.end();
  } catch {
    if (opts.signal.aborted) throw new StreamAbortedError();
    if (!finished) {
      opts.onEvent({
        type: "error",
        error: {
          source: "network",
          status: 0,
          code: "stream_interrupted",
          title: "Соединение прервано",
          message: "Поток ответа оборвался до завершения. Повторите запрос.",
        },
      });
    }
    return;
  }

  if (!finished) {
    if (opts.signal.aborted) throw new StreamAbortedError();
    opts.onEvent({
      type: "error",
      error: {
        source: "network",
        status: 0,
        code: "stream_incomplete",
        title: "Ответ не завершён",
        message: "Сервер закрыл поток без завершения генерации. Повторите запрос.",
      },
    });
  }
}
