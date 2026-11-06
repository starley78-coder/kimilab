import "katex/dist/katex.min.css";

import { useQuery } from "@tanstack/react-query";
import { Check, Copy, ImageOff, OctagonPause, Scissors } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { toast } from "sonner";

import { Attachment, AttachmentPreview, Attachments } from "@/components/ai-elements/attachments";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import type { LiveTurn } from "@/components/chat/chat-runtime";
import { MessageUsage, usageFromRow } from "@/components/chat/usage";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { signedUrlsQuery, type MessageRow } from "@/lib/chat/data";
import type { StoredAttachment } from "@/lib/chat/schema";
import { formatSeconds } from "@/lib/format";
import { REASONING_EFFORT_LABELS, isReasoningEffort } from "@/lib/kimi/config";

const streamdownTranslations = {
  close: "Закрыть",
  copied: "Скопировано",
  copyCode: "Копировать код",
  copyLink: "Копировать ссылку",
  copyTable: "Копировать таблицу",
  copyTableAsCsv: "Копировать как CSV",
  copyTableAsMarkdown: "Копировать как Markdown",
  copyTableAsTsv: "Копировать как TSV",
  downloadFile: "Скачать файл",
  downloadImage: "Скачать изображение",
  downloadTable: "Скачать таблицу",
  downloadTableAsCsv: "Скачать как CSV",
  downloadTableAsMarkdown: "Скачать как Markdown",
  externalLinkWarning: "Вы переходите на внешний сайт",
  openExternalLink: "Открыть внешнюю ссылку",
  openLink: "Открыть ссылку",
  viewFullscreen: "Во весь экран",
  exitFullscreen: "Выйти из полноэкранного режима",
};

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <MessageAction
      tooltip={copied ? "Скопировано" : "Копировать ответ"}
      label="Копировать ответ"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          toast.error("Не удалось скопировать");
        }
      }}
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </MessageAction>
  );
}

function ImageLightbox({ url, name, onClose }: { url: string | null; name: string; onClose: () => void }) {
  return (
    <Dialog open={!!url} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(92vw,1100px)] border-none bg-transparent p-0 shadow-none">
        <DialogTitle className="sr-only">{name}</DialogTitle>
        {url && <img src={url} alt={name} className="max-h-[85vh] w-full rounded-xl object-contain" />}
      </DialogContent>
    </Dialog>
  );
}

function MessageImages({
  attachments,
  previews,
}: {
  attachments: StoredAttachment[];
  previews?: { url: string; name: string; mediaType: string }[] | undefined;
}) {
  const paths = previews?.length ? [] : attachments.map((a) => a.path);
  const signed = useQuery(signedUrlsQuery(paths));
  const [open, setOpen] = useState<{ url: string; name: string } | null>(null);

  const items = previews?.length
    ? previews.map((p, i) => ({ id: `p-${i}`, url: p.url, name: p.name, mediaType: p.mediaType }))
    : attachments.map((a) => ({
        id: a.path,
        url: signed.data?.[a.path] ?? "",
        name: a.name,
        mediaType: a.mediaType,
      }));
  if (!items.length) return null;

  return (
    <>
      <Attachments variant="grid" className="ml-auto">
        {items.map((item) =>
          item.url ? (
            <Attachment
              key={item.id}
              data={{ id: item.id, type: "file", url: item.url, mediaType: item.mediaType, filename: item.name }}
              className="size-28 cursor-zoom-in border"
              onClick={() => setOpen({ url: item.url, name: item.name })}
            >
              <AttachmentPreview />
            </Attachment>
          ) : (
            <div
              key={item.id}
              className="flex size-28 items-center justify-center rounded-lg border bg-muted text-muted-foreground"
              title={signed.isError ? "Изображение недоступно" : "Загрузка…"}
            >
              {signed.isError ? <ImageOff className="size-4" /> : <span className="size-4 animate-pulse rounded-full bg-border" />}
            </div>
          ),
        )}
      </Attachments>
      <ImageLightbox url={open?.url ?? null} name={open?.name ?? ""} onClose={() => setOpen(null)} />
    </>
  );
}

export function UserMessage({
  content,
  attachments,
  previews,
}: {
  content: string;
  attachments: StoredAttachment[];
  previews?: { url: string; name: string; mediaType: string }[] | undefined;
}) {
  return (
    <Message from="user" className="max-w-[85%] sm:max-w-[75%]">
      {(attachments.length > 0 || (previews?.length ?? 0) > 0) && (
        <MessageImages attachments={attachments} previews={previews} />
      )}
      {content.trim() && (
        <MessageContent>
          <p className="whitespace-pre-wrap break-words text-[0.95rem] leading-relaxed">{content}</p>
        </MessageContent>
      )}
    </Message>
  );
}

function AssistantMeta({ row }: { row: MessageRow }) {
  const effort = isReasoningEffort(row.reasoning_effort) ? REASONING_EFFORT_LABELS[row.reasoning_effort] : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <MessageActions className="-ml-1.5">
        {row.content && <CopyAction text={row.content} />}
      </MessageActions>
      <MessageUsage usage={usageFromRow(row)} />
      {effort && <span className="text-[0.7rem] text-muted-foreground">Рассуждения: {effort}</span>}
      {row.status === "stopped" && (
        <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[0.7rem] text-foreground">
          <OctagonPause className="size-3 text-warning" /> Генерация остановлена
        </span>
      )}
      {row.finish_reason === "length" && (
        <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[0.7rem] text-foreground">
          <Scissors className="size-3 text-warning" /> Ответ обрезан по лимиту длины
        </span>
      )}
    </div>
  );
}

export const AssistantMessage = memo(function AssistantMessage({ row }: { row: MessageRow }) {
  return (
    <Message from="assistant" className="max-w-full">
      <MessageContent>
        {row.content.trim() ? (
          <MessageResponse className="prose-answer" translations={streamdownTranslations}>
            {row.content}
          </MessageResponse>
        ) : (
          <p className="text-sm italic text-muted-foreground">
            Модель не вернула текст ответа{row.finish_reason ? ` (finish_reason: ${row.finish_reason})` : ""}.
          </p>
        )}
      </MessageContent>
      <AssistantMeta row={row} />
    </Message>
  );
});

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function LiveAssistant({ turn }: { turn: LiveTurn }) {
  const running = turn.status === "submitted" || turn.status === "streaming" || turn.status === "uploading";
  const now = useNow(running);
  const elapsed = formatSeconds(now - turn.startedAt);

  const label =
    turn.status === "uploading"
      ? "Загружаю изображения…"
      : turn.status === "finalizing"
        ? "Сохраняю…"
        : turn.phase === "thinking"
          ? `Думает · ${elapsed}`
          : turn.phase === "answering"
            ? `Пишет ответ · ${elapsed}`
            : `Подключаюсь к Kimi · ${elapsed}`;

  if (turn.status === "error" && !turn.text) return null;

  return (
    <Message from="assistant" className="max-w-full" aria-live="polite">
      <MessageContent>
        {turn.text ? (
          <MessageResponse
            className="prose-answer"
            isAnimating={running}
            {...(running ? { caret: "block" as const } : {})}
            translations={streamdownTranslations}
          >
            {turn.text}
          </MessageResponse>
        ) : (
          <Shimmer className="text-sm" duration={1.6}>
            {label}
          </Shimmer>
        )}
      </MessageContent>
      {turn.text && running && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-1.5 animate-pulse rounded-full bg-signal" aria-hidden="true" />
          {label}
        </p>
      )}
      {turn.text && turn.status === "error" && (
        <p className="text-xs text-muted-foreground">Ответ получен не полностью.</p>
      )}
    </Message>
  );
}
