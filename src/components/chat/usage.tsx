import { ArrowDownToLine, ArrowUpFromLine, Sigma } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isEmptyStoppedReply, type MessageRow } from "@/lib/chat/data";
import { formatTokens } from "@/lib/format";
import type { Usage } from "@/lib/kimi/sse";

export function MessageUsage({ usage }: { usage: Usage | null }) {
  if (!usage) {
    return (
      <span className="text-xs text-muted-foreground" title="Провайдер не вернул данные usage">
        usage: нет данных
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-default items-center gap-2.5 font-mono text-[0.7rem] tabular-nums text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ArrowUpFromLine className="size-3" />
            {formatTokens(usage.prompt_tokens)}
          </span>
          <span className="inline-flex items-center gap-1">
            <ArrowDownToLine className="size-3" />
            {formatTokens(usage.completion_tokens)}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
          <span>Входящие токены</span>
          <span className="text-right font-mono">{formatTokens(usage.prompt_tokens)}</span>
          <span>Исходящие токены</span>
          <span className="text-right font-mono">{formatTokens(usage.completion_tokens)}</span>
          {usage.reasoning_tokens !== null && (
            <>
              <span>из них рассуждения</span>
              <span className="text-right font-mono">{formatTokens(usage.reasoning_tokens)}</span>
            </>
          )}
          {usage.cached_tokens != null && usage.cached_tokens > 0 && (
            <>
              <span>из кэша (дешевле)</span>
              <span className="text-right font-mono">{formatTokens(usage.cached_tokens)}</span>
            </>
          )}
          {usage.total_tokens !== null && (
            <>
              <span>Всего</span>
              <span className="text-right font-mono">{formatTokens(usage.total_tokens)}</span>
            </>
          )}
        </div>
        <p className="mt-1.5 opacity-70">Данные поля usage из ответа API</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function usageFromRow(row: MessageRow): Usage | null {
  if (row.prompt_tokens === null && row.completion_tokens === null && row.total_tokens === null)
    return null;
  return {
    prompt_tokens: row.prompt_tokens,
    completion_tokens: row.completion_tokens,
    reasoning_tokens: row.reasoning_tokens,
    total_tokens: row.total_tokens,
    cached_tokens: row.cached_tokens,
  };
}

export interface ConversationTotals {
  prompt: number;
  completion: number;
  reasoning: number;
  replies: number;
  repliesWithUsage: number;
}

export function conversationTotals(messages: MessageRow[]): ConversationTotals {
  const totals: ConversationTotals = {
    prompt: 0,
    completion: 0,
    reasoning: 0,
    replies: 0,
    repliesWithUsage: 0,
  };
  for (const m of messages) {
    if (m.role !== "assistant" || isEmptyStoppedReply(m)) continue;
    totals.replies++;
    if (m.prompt_tokens !== null || m.completion_tokens !== null) totals.repliesWithUsage++;
    totals.prompt += m.prompt_tokens ?? 0;
    totals.completion += m.completion_tokens ?? 0;
    totals.reasoning += m.reasoning_tokens ?? 0;
  }
  return totals;
}

export function ConversationUsage({ messages }: { messages: MessageRow[] }) {
  const t = conversationTotals(messages);
  if (t.replies === 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="hidden cursor-default items-center gap-3 rounded-full border bg-card px-3 py-1 font-mono text-[0.7rem] tabular-nums text-muted-foreground sm:inline-flex">
          <Sigma className="size-3.5" />
          <span className="inline-flex items-center gap-1">
            <ArrowUpFromLine className="size-3" />
            {formatTokens(t.prompt)}
          </span>
          <span className="inline-flex items-center gap-1">
            <ArrowDownToLine className="size-3" />
            {formatTokens(t.completion)}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        <p className="mb-1 font-medium">Расход в этом диалоге</p>
        <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
          <span>Входящие токены</span>
          <span className="text-right font-mono">{formatTokens(t.prompt)}</span>
          <span>Исходящие токены</span>
          <span className="text-right font-mono">{formatTokens(t.completion)}</span>
          {t.reasoning > 0 && (
            <>
              <span>из них рассуждения</span>
              <span className="text-right font-mono">{formatTokens(t.reasoning)}</span>
            </>
          )}
          <span>Ответов</span>
          <span className="text-right font-mono">{t.replies}</span>
        </div>
        {t.repliesWithUsage < t.replies && (
          <p className="mt-1.5 opacity-70">
            {t.replies - t.repliesWithUsage} отв. без данных usage (например, остановленные)
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
