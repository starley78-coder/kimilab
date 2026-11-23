import { useQuery } from "@tanstack/react-query";
import { Gauge, ScrollText } from "lucide-react";
import { useEffect, useState } from "react";

import { useConversationActions } from "@/components/chat/conversation-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  isEmptyStoppedReply,
  kimiStatusQuery,
  userSettingsQuery,
  type ConversationRow,
  type MessageRow,
} from "@/lib/chat/data";
import { PROMPT_PRESETS } from "@/lib/chat/presets";
import { formatTokens } from "@/lib/format";
import { contextUsage } from "@/lib/kimi/balance";
import { cn } from "@/lib/utils";

/**
 * Tokens the last request occupied: prompt + completion of the latest reply that has usage.
 * Only real API usage is used; null when no reply reported it.
 */
export function lastContextTokens(
  messages: Pick<
    MessageRow,
    "role" | "status" | "content" | "prompt_tokens" | "completion_tokens"
  >[],
): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "assistant" || isEmptyStoppedReply(m)) continue;
    if (m.prompt_tokens === null && m.completion_tokens === null) continue;
    return (m.prompt_tokens ?? 0) + (m.completion_tokens ?? 0);
  }
  return null;
}

export function ContextMeter({ messages }: { messages: MessageRow[] }) {
  const status = useQuery(kimiStatusQuery());
  const used = lastContextTokens(messages);
  if (used === null) return null;
  const window = status.data?.contextWindow ?? null;
  const ctx = window ? contextUsage(used, window) : null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "hidden cursor-default items-center gap-2 rounded-full border bg-card px-3 py-1 font-mono text-[0.7rem] tabular-nums text-muted-foreground md:inline-flex",
            ctx?.level === "warn" && "border-warning/50",
            ctx?.level === "critical" && "border-destructive/50 text-destructive",
          )}
        >
          <Gauge className="size-3.5" />
          {formatTokens(used)}
          {ctx && (
            <>
              <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <span
                  className={cn(
                    "block h-full rounded-full",
                    ctx.level === "critical"
                      ? "bg-destructive"
                      : ctx.level === "warn"
                        ? "bg-warning"
                        : "bg-signal",
                  )}
                  style={{ width: `${Math.max(2, ctx.pct)}%` }}
                />
              </span>
              {ctx.pct.toFixed(ctx.pct < 10 ? 1 : 0)}%
            </>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-72 text-xs">
        <p className="font-medium">Окно контекста</p>
        <p className="mt-1 opacity-80">
          Последний запрос занял {formatTokens(used)} токенов (вход + ответ, по usage API).
        </p>
        {window && ctx ? (
          <>
            <p className="mt-1 opacity-80">
              Осталось ≈ {formatTokens(ctx.remaining)} из {formatTokens(window)}.
            </p>
            {ctx.level !== "ok" && (
              <p className="mt-1 font-medium">
                Окно почти заполнено: сделайте «Резюме и шаги» и продолжите в новом диалоге.
              </p>
            )}
          </>
        ) : (
          <p className="mt-1 opacity-80">
            Размер окна не задан — добавьте серверный секрет KIMI_CONTEXT_WINDOW.
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/** Fills the instruction field with a ready-made preset (nothing is saved until "Сохранить"). */
export function PresetPicker({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Пресеты инструкций">
      <span className="text-xs text-muted-foreground">Пресеты:</span>
      {PROMPT_PRESETS.map((p) => (
        <Tooltip key={p.id}>
          <TooltipTrigger asChild>
            <Button type="button" variant="outline" size="xs" onClick={() => onPick(p.text)}>
              {p.title}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-60 text-xs">{p.hint}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

export function SystemPromptButton({ conversation }: { conversation: ConversationRow }) {
  const [open, setOpen] = useState(false);
  const custom = conversation.system_prompt !== null;
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="quiet"
            size="icon-sm"
            onClick={() => setOpen(true)}
            aria-label="Системная инструкция диалога"
            className="relative"
          >
            <ScrollText />
            {custom && (
              <span
                className="absolute top-1 right-1 size-1.5 rounded-full bg-signal"
                aria-hidden="true"
              />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {custom ? "Своя инструкция диалога" : "Системная инструкция"}
        </TooltipContent>
      </Tooltip>
      <SystemPromptDialog conversation={conversation} open={open} onOpenChange={setOpen} />
    </>
  );
}

function SystemPromptDialog({
  conversation,
  open,
  onOpenChange,
}: {
  conversation: ConversationRow;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { setSystemPrompt } = useConversationActions();
  const defaults = useQuery({ ...userSettingsQuery(), enabled: open });
  const [mode, setMode] = useState<"default" | "custom">("default");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode(conversation.system_prompt === null ? "default" : "custom");
    setValue(conversation.system_prompt ?? "");
  }, [open, conversation.system_prompt]);

  const defaultText = defaults.data?.default_system_prompt ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Системная инструкция</DialogTitle>
          <DialogDescription>
            Отправляется модели первой (role: system) при каждом запросе в этом диалоге.
          </DialogDescription>
        </DialogHeader>
        <div
          role="radiogroup"
          aria-label="Источник инструкции"
          className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1"
        >
          {(
            [
              ["default", "По умолчанию"],
              ["custom", "Своя для диалога"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={mode === v}
              onClick={() => setMode(v)}
              className={cn(
                "rounded-lg px-2 py-1.5 text-sm font-medium transition-colors",
                mode === v
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === "default" ? (
          <div className="rounded-xl border bg-muted/40 px-3 py-2.5 text-sm">
            {defaults.isPending ? (
              <span className="text-muted-foreground">Загрузка…</span>
            ) : defaultText ? (
              <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-muted-foreground">
                {defaultText}
              </p>
            ) : (
              <span className="text-muted-foreground">
                Инструкция по умолчанию не задана — её можно указать в настройках.
              </span>
            )}
          </div>
        ) : (
          <div className="grid gap-2">
            <PresetPicker onPick={setValue} />
            <Textarea
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={20_000}
              placeholder="Например: «Ты — ревьюер кода. Указывай на ошибки и предлагай исправления.» Пустое поле — без инструкции."
              className="max-h-72 min-h-32 text-sm"
              aria-label="Инструкция диалога"
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await setSystemPrompt(conversation, mode === "default" ? null : value.trim());
              setSaving(false);
              onOpenChange(false);
            }}
          >
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
