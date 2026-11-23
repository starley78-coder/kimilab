import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ChatError } from "@/lib/kimi/errors";
import { SUMMARY_MODEL, buildTranscript } from "@/lib/summary/prepare";

export interface SummaryRecord {
  id: string;
  conversation_id: string;
  summary: string;
  action_items: string[];
  model: string;
  messages_used: number;
  truncated: boolean;
  created_at: string;
}

export type SummaryResult = { ok: true; record: SummaryRecord } | { ok: false; error: ChatError };

function fail(status: number, code: string, title: string, message: string): SummaryResult {
  return { ok: false, error: { source: "app", status, code, title, message } };
}

function gatewayFailure(status: number): SummaryResult {
  switch (status) {
    case 402:
      return fail(
        402,
        "ai_credits",
        "Закончились кредиты Lovable AI",
        "Резюме делается через Lovable AI. Пополните кредиты в Settings → Plans & credits.",
      );
    case 403:
      return fail(
        403,
        "ai_forbidden",
        "Lovable AI недоступен",
        "Пространство запретило использование Lovable AI или достигнут лимит расходов.",
      );
    case 429:
      return fail(
        429,
        "ai_rate_limited",
        "Слишком много запросов к Lovable AI",
        "Подождите минуту и попробуйте ещё раз.",
      );
    case 422:
      return fail(
        422,
        "ai_bad_output",
        "Не удалось разобрать резюме",
        "Модель вернула ответ в неожиданном формате. Попробуйте ещё раз.",
      );
    default:
      return fail(
        status,
        "ai_failed",
        "Не удалось подготовить резюме",
        status >= 500 ? "Сервис Lovable AI временно недоступен." : `Ошибка ${status}.`,
      );
  }
}

/** Summary + next steps for one conversation via Lovable AI Gateway. Owner only. */
export const generateConversationSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ conversationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<SummaryResult> => {
    const { supabase, userId } = context;
    const { data: access } = await supabase.rpc("claim_workspace_access");
    if (!(access as { has_access?: boolean } | null)?.has_access)
      return fail(403, "no_workspace_access", "Нет доступа", "Доступно только владельцу.");

    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey)
      return fail(503, "ai_not_configured", "Lovable AI не настроен", "Нет ключа Lovable AI.");

    const { data: rows, error } = await supabase
      .from("messages")
      .select("role, content, status")
      .eq("conversation_id", data.conversationId)
      .order("seq");
    if (error) return fail(500, "history_failed", "Ошибка истории", "Не удалось загрузить диалог.");
    const transcript = buildTranscript(rows ?? []);
    if (!transcript.count)
      return fail(400, "empty", "Нечего резюмировать", "В диалоге ещё нет сообщений.");

    const { summarizeTranscript, GatewayError } = await import("@/lib/summary/gateway.server");
    let output;
    try {
      output = await summarizeTranscript(apiKey, transcript.text);
    } catch (e) {
      if (e instanceof GatewayError) return gatewayFailure(e.status);
      console.error("[summary] failed", e instanceof Error ? e.message : e);
      return gatewayFailure(500);
    }

    const { data: saved, error: saveError } = await supabase
      .from("conversation_summaries")
      .insert({
        user_id: userId,
        conversation_id: data.conversationId,
        summary: output.summary,
        action_items: output.action_items,
        model: SUMMARY_MODEL,
        messages_used: transcript.count,
        truncated: transcript.truncated,
      })
      .select()
      .single();
    if (saveError || !saved)
      return fail(500, "save_failed", "Не удалось сохранить резюме", "Повторите попытку.");
    return {
      ok: true,
      record: {
        ...saved,
        action_items: Array.isArray(saved.action_items)
          ? saved.action_items.filter((x): x is string => typeof x === "string")
          : [],
      },
    };
  });
