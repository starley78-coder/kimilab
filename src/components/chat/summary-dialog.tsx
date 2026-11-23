import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ClipboardCopy, ListChecks, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ErrorCard } from "@/components/chat/error-card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { latestSummaryQuery, type ConversationRow } from "@/lib/chat/data";
import type { ChatError } from "@/lib/kimi/errors";
import { generateConversationSummary, type SummaryRecord } from "@/lib/summary.functions";

type Ctx = { openSummary: (c: Pick<ConversationRow, "id" | "title">) => void };
const SummaryContext = createContext<Ctx | null>(null);

export function useSummary() {
  const ctx = useContext(SummaryContext);
  if (!ctx) throw new Error("useSummary must be used inside SummaryProvider");
  return ctx;
}

export function summaryToMarkdown(r: Pick<SummaryRecord, "summary" | "action_items">): string {
  const steps = r.action_items.length
    ? `\n\n**Дальнейшие шаги**\n${r.action_items.map((a) => `- [ ] ${a}`).join("\n")}`
    : "";
  return `**Резюме**\n\n${r.summary}${steps}`;
}

export function SummaryProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<Pick<ConversationRow, "id" | "title"> | null>(null);
  const value = useMemo<Ctx>(() => ({ openSummary: setTarget }), []);
  return (
    <SummaryContext.Provider value={value}>
      {children}
      <SummaryDialog conversation={target} onClose={() => setTarget(null)} />
    </SummaryContext.Provider>
  );
}

function SummaryDialog({
  conversation,
  onClose,
}: {
  conversation: Pick<ConversationRow, "id" | "title"> | null;
  onClose: () => void;
}) {
  const open = !!conversation;
  const queryClient = useQueryClient();
  const generate = useServerFn(generateConversationSummary);
  const latest = useQuery({
    ...latestSummaryQuery(conversation?.id ?? "none"),
    enabled: open,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [copied, setCopied] = useState(false);

  const run = useCallback(async () => {
    if (!conversation) return;
    setBusy(true);
    setError(null);
    try {
      const res = await generate({ data: { conversationId: conversation.id } });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      queryClient.setQueryData(latestSummaryQuery(conversation.id).queryKey, res.record);
      window.__lovableEvents?.track?.("project.summary_generated", {
        action_items: res.record.action_items.length,
        truncated: res.record.truncated,
      });
    } catch (e) {
      setError({
        source: "network",
        status: 0,
        code: "summary_failed",
        title: "Не удалось подготовить резюме",
        message: e instanceof Error ? e.message : "Проверьте соединение и повторите.",
      });
    } finally {
      setBusy(false);
    }
  }, [conversation, generate, queryClient]);

  const record = latest.data ?? null;

  const copy = async () => {
    if (!record) return;
    await navigator.clipboard.writeText(summaryToMarkdown(record));
    setCopied(true);
    toast.success("Резюме скопировано");
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="size-4" /> Резюме и шаги
          </DialogTitle>
          <DialogDescription className="truncate">
            {conversation?.title ?? ""} · готовит Lovable AI по сообщениям диалога
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto scrollbar-thin">
          {latest.isLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Загрузка…
            </div>
          ) : record ? (
            <div className="grid gap-4 text-sm">
              <p className="whitespace-pre-wrap leading-relaxed">{record.summary}</p>
              <div>
                <h3 className="mb-2 font-medium">Дальнейшие шаги</h3>
                {record.action_items.length ? (
                  <ul className="grid gap-1.5">
                    {record.action_items.map((a, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="mt-0.5 size-4 shrink-0 rounded border" aria-hidden="true" />
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">Конкретных действий в диалоге нет.</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {new Date(record.created_at).toLocaleString("ru-RU")} · сообщений:{" "}
                {record.messages_used}
                {record.truncated && " · диалог длинный, учтены последние сообщения"}
              </p>
            </div>
          ) : (
            !busy &&
            !error && (
              <p className="py-4 text-sm text-muted-foreground">
                Резюме для этого диалога ещё не делали. Модель прочитает сообщения и предложит
                список дальнейших действий. Тратит кредиты Lovable AI.
              </p>
            )
          )}
          {busy && (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Готовлю резюме…
            </div>
          )}
          {error && <ErrorCard error={error} />}
        </div>

        <DialogFooter className="gap-2">
          {record && (
            <Button variant="outline" onClick={() => void copy()} disabled={busy}>
              {copied ? <Check /> : <ClipboardCopy />} Копировать
            </Button>
          )}
          <Button onClick={() => void run()} disabled={busy || !conversation}>
            {record ? <RefreshCw /> : <Sparkles />}
            {record ? "Обновить резюме" : "Сделать резюме"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
