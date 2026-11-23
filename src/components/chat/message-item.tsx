import "katex/dist/katex.min.css";

import { useQuery } from "@tanstack/react-query";
import {
  Check,
  Code2,
  Copy,
  FileText,
  ImageOff,
  OctagonPause,
  Pencil,
  RefreshCw,
  Scissors,
} from "lucide-react";
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
import { useCodeDrawer } from "@/components/chat/code-drawer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageUsage, usageFromRow } from "@/components/chat/usage";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { signedUrlsQuery, type MessageRow } from "@/lib/chat/data";
import { extractCodeBlocks, fileNameForBlock } from "@/lib/chat/code-blocks";
import type { StoredAttachment } from "@/lib/chat/schema";
import {
  buildMessageContent,
  languageForFile,
  splitMessageContent,
  type TextFile,
} from "@/lib/chat/text-files";
import { formatBytes } from "@/lib/format";
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

function CopyAction({ text, label = "Копировать ответ" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <MessageAction
      tooltip={copied ? "Скопировано" : label}
      label={label}
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

function ImageLightbox({
  url,
  name,
  onClose,
}: {
  url: string | null;
  name: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!url} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(92vw,1100px)] border-none bg-transparent p-0 shadow-none">
        <DialogTitle className="sr-only">{name}</DialogTitle>
        {url && (
          <img src={url} alt={name} className="max-h-[85vh] w-full rounded-xl object-contain" />
        )}
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
              data={{
                id: item.id,
                type: "file",
                url: item.url,
                mediaType: item.mediaType,
                filename: item.name,
              }}
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
              {signed.isError ? (
                <ImageOff className="size-4" />
              ) : (
                <span className="size-4 animate-pulse rounded-full bg-border" />
              )}
            </div>
          ),
        )}
      </Attachments>
      <ImageLightbox
        url={open?.url ?? null}
        name={open?.name ?? ""}
        onClose={() => setOpen(null)}
      />
    </>
  );
}

function FileChips({ files }: { files: TextFile[] }) {
  const { openCode } = useCodeDrawer();
  if (!files.length) return null;
  const items = files.map((f) => ({
    name: f.name,
    language: languageForFile(f.name),
    code: f.content,
  }));
  return (
    <div className="ml-auto flex flex-wrap justify-end gap-2">
      {files.map((f, i) => (
        <button
          key={`${f.name}-${i}`}
          type="button"
          onClick={() => openCode("Прикреплённые файлы", items, i)}
          className="flex max-w-60 items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted"
          title="Открыть файл"
        >
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <span className="block truncate font-medium">{f.name}</span>
            <span className="block text-muted-foreground">
              {formatBytes(new TextEncoder().encode(f.content).length)} ·{" "}
              {f.content.split("\n").length} строк
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function UserEditor({
  initial,
  onCancel,
  onSave,
}: {
  initial: string;
  onCancel: () => void;
  onSave: (text: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await onSave(value);
    } catch {
      setSaving(false);
    }
  };
  return (
    <div className="ml-auto grid w-full max-w-[85%] gap-2 sm:max-w-[75%]">
      <Textarea
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
        }}
        aria-label="Изменить сообщение"
        className="max-h-80 min-h-24 rounded-xl bg-card text-[0.95rem] leading-relaxed"
      />
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-[0.7rem] text-muted-foreground">
          Ответы после этого сообщения будут заменены новым ответом
        </span>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Отмена
        </Button>
        <Button size="sm" onClick={save} disabled={saving}>
          Отправить
        </Button>
      </div>
    </div>
  );
}

export function UserMessage({
  content,
  attachments,
  previews,
  onEdit,
}: {
  content: string;
  attachments: StoredAttachment[];
  previews?: { url: string; name: string; mediaType: string }[] | undefined;
  /** When set, the message can be edited and resent. */
  onEdit?: ((content: string) => Promise<void>) | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const { text, files } = splitMessageContent(content);
  return (
    <div className="group/user flex flex-col items-end gap-1.5">
      {editing && onEdit ? (
        <>
          <FileChips files={files} />
          <UserEditor
            initial={text}
            onCancel={() => setEditing(false)}
            onSave={async (next) => {
              await onEdit(buildMessageContent(next, files));
              setEditing(false);
            }}
          />
        </>
      ) : (
        <>
          <Message from="user" className="max-w-[85%] sm:max-w-[75%]">
            {(attachments.length > 0 || (previews?.length ?? 0) > 0) && (
              <MessageImages attachments={attachments} previews={previews} />
            )}
            <FileChips files={files} />
            {text && (
              <MessageContent>
                <p className="whitespace-pre-wrap break-words text-[0.95rem] leading-relaxed">
                  {text}
                </p>
              </MessageContent>
            )}
          </Message>
          {onEdit && (
            <MessageActions className="opacity-100 transition-opacity sm:opacity-0 sm:group-hover/user:opacity-100 sm:focus-within:opacity-100">
              {text && <CopyAction text={text} label="Копировать сообщение" />}
              <MessageAction
                tooltip="Изменить и отправить заново"
                label="Изменить сообщение"
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-3.5" />
              </MessageAction>
            </MessageActions>
          )}
        </>
      )}
    </div>
  );
}

function AssistantMeta({
  row,
  onRegenerate,
}: {
  row: MessageRow;
  onRegenerate?: (() => void) | undefined;
}) {
  const { openCode } = useCodeDrawer();
  const blocks = extractCodeBlocks(row.content);
  const effort = isReasoningEffort(row.reasoning_effort)
    ? REASONING_EFFORT_LABELS[row.reasoning_effort]
    : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <MessageActions className="-ml-1.5">
        {row.content && <CopyAction text={row.content} />}
        {onRegenerate && (
          <MessageAction
            tooltip="Сгенерировать ответ заново"
            label="Повторить ответ"
            onClick={onRegenerate}
          >
            <RefreshCw className="size-3.5" />
          </MessageAction>
        )}
        {blocks.length > 0 && (
          <MessageAction
            tooltip="Открыть код в панели"
            label="Открыть код в панели"
            onClick={() =>
              openCode(
                "Код из ответа",
                blocks.map((b, i) => ({
                  name: fileNameForBlock(b, i),
                  language: b.language,
                  code: b.code,
                })),
              )
            }
          >
            <Code2 className="size-3.5" />
            {blocks.length > 1 && (
              <span className="text-[0.7rem] tabular-nums">{blocks.length}</span>
            )}
          </MessageAction>
        )}
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

export const AssistantMessage = memo(function AssistantMessage({
  row,
  onRegenerate,
}: {
  row: MessageRow;
  onRegenerate?: (() => void) | undefined;
}) {
  return (
    <Message from="assistant" className="max-w-full">
      <MessageContent>
        {row.content.trim() ? (
          <MessageResponse className="prose-answer" translations={streamdownTranslations}>
            {row.content}
          </MessageResponse>
        ) : (
          <p className="text-sm italic text-muted-foreground">
            Модель не вернула текст ответа
            {row.finish_reason ? ` (finish_reason: ${row.finish_reason})` : ""}.
          </p>
        )}
      </MessageContent>
      <AssistantMeta row={row} onRegenerate={onRegenerate} />
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
  const running =
    turn.status === "submitted" || turn.status === "streaming" || turn.status === "uploading";
  const now = useNow(running);
  const elapsed = formatSeconds(now - turn.startedAt);

  const label =
    turn.status === "uploading"
      ? "Загружаю изображения…"
      : turn.status === "finalizing"
        ? "Сохраняю…"
        : turn.stopRequested
          ? "Останавливаю…"
          : turn.phase === "thinking"
            ? `Думает · ${elapsed}`
            : turn.phase === "answering"
              ? `Пишет ответ · ${elapsed}`
              : turn.phase === "full"
                ? `Жду полный ответ (без потоковой передачи) · ${elapsed}`
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
