import { Eraser, FileText, ImagePlus, Paperclip, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@/components/ai-elements/attachments";
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputProvider,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  usePromptInputController,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { isTurnActive, useChatRuntime, useLiveTurn } from "@/components/chat/chat-runtime";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_INPUT_BYTES,
  MAX_IMAGES_PER_MESSAGE,
  MAX_MESSAGE_CHARS,
} from "@/lib/chat/schema";
import {
  MAX_TEXT_FILES_PER_MESSAGE,
  MAX_TEXT_FILE_BYTES,
  TEXT_FILE_ACCEPT,
  buildMessageContent,
  isTextFileName,
  type TextFile,
} from "@/lib/chat/text-files";
import { formatBytes } from "@/lib/format";
import {
  MODEL_DISPLAY_NAME,
  REASONING_EFFORTS,
  REASONING_EFFORT_HINTS,
  REASONING_EFFORT_LABELS,
  isReasoningEffort,
} from "@/lib/kimi/config";
import { useReasoningEffort } from "@/lib/preferences";

function screenshotStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function ComposerAttachments() {
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) return null;
  return (
    <PromptInputHeader className="px-3 pt-3">
      <Attachments variant="grid" className="ml-0 w-full justify-start">
        {attachments.files.map((file) => (
          <Attachment
            key={file.id}
            data={file}
            onRemove={() => attachments.remove(file.id)}
            className="size-20 border"
          >
            <AttachmentPreview />
            <AttachmentRemove label="Убрать изображение" className="opacity-100" />
          </Attachment>
        ))}
      </Attachments>
    </PromptInputHeader>
  );
}

function AttachButton() {
  const attachments = usePromptInputAttachments();
  const full = attachments.files.length >= MAX_IMAGES_PER_MESSAGE;
  return (
    <PromptInputButton
      tooltip={
        full
          ? `Не больше ${MAX_IMAGES_PER_MESSAGE} изображений`
          : "Прикрепить изображение (PNG, JPG, WebP)"
      }
      onClick={() => attachments.openFileDialog()}
      disabled={full}
      aria-label="Прикрепить изображение"
    >
      <ImagePlus className="size-4" />
    </PromptInputButton>
  );
}

function ClearButton({ hasFiles, onClearFiles }: { hasFiles: boolean; onClearFiles: () => void }) {
  const controller = usePromptInputController();
  const empty =
    !controller.textInput.value && controller.attachments.files.length === 0 && !hasFiles;
  return (
    <PromptInputButton
      tooltip="Очистить поле"
      aria-label="Очистить поле"
      disabled={empty}
      onClick={() => {
        controller.textInput.clear();
        controller.attachments.clear();
        onClearFiles();
      }}
    >
      <Eraser className="size-4" />
    </PromptInputButton>
  );
}

function EffortSelect() {
  const [effort, setEffort] = useReasoningEffort();
  return (
    <PromptInputSelect value={effort} onValueChange={(v) => isReasoningEffort(v) && setEffort(v)}>
      <PromptInputSelectTrigger
        aria-label="Уровень рассуждений"
        className="h-8 gap-1.5 rounded-md px-2 text-xs font-medium"
      >
        <span className="hidden text-muted-foreground sm:inline">Рассуждения</span>
        <PromptInputSelectValue>{REASONING_EFFORT_LABELS[effort]}</PromptInputSelectValue>
      </PromptInputSelectTrigger>
      <PromptInputSelectContent align="start">
        {REASONING_EFFORTS.map((e) => (
          <PromptInputSelectItem key={e} value={e}>
            <span className="flex flex-col">
              <span className="font-medium">{REASONING_EFFORT_LABELS[e]}</span>
              <span className="text-xs text-muted-foreground">{REASONING_EFFORT_HINTS[e]}</span>
            </span>
          </PromptInputSelectItem>
        ))}
      </PromptInputSelectContent>
    </PromptInputSelect>
  );
}

function SubmitControl({
  conversationId,
  submitting,
  hasFiles,
  tooLong,
}: {
  conversationId: string | null;
  submitting: boolean;
  hasFiles: boolean;
  tooLong: boolean;
}) {
  const controller = usePromptInputController();
  const turn = useLiveTurn(conversationId);
  const { stop } = useChatRuntime();
  const active = isTurnActive(turn);
  const status = submitting
    ? "submitted"
    : !active
      ? undefined
      : turn?.status === "streaming"
        ? "streaming"
        : "submitted";
  const empty =
    (!controller.textInput.value.trim() &&
      controller.attachments.files.length === 0 &&
      !hasFiles) ||
    tooLong;
  const canStop = active && !!conversationId && turn?.status !== "uploading";
  return (
    <PromptInputSubmit
      status={status}
      onStop={canStop ? () => stop(conversationId!) : undefined}
      disabled={submitting || (active ? !canStop : empty)}
      aria-label={active ? "Остановить генерацию" : "Отправить"}
      className="rounded-lg"
    />
  );
}

function ComposerInner({
  conversationId,
  autoFocusKey,
}: {
  conversationId: string | null;
  autoFocusKey: string;
}) {
  const { send } = useChatRuntime();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const turn = useLiveTurn(conversationId);
  const active = isTurnActive(turn);
  const [submitting, setSubmitting] = useState(false);
  const [textFiles, setTextFiles] = useState<TextFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const textFileInput = useRef<HTMLInputElement | null>(null);
  const controller = usePromptInputController();
  const contentLength = buildMessageContent(controller.textInput.value, textFiles).length;
  const tooLong = contentLength > MAX_MESSAGE_CHARS;

  useEffect(() => {
    textareaRef.current?.focus();
  }, [autoFocusKey]);

  const addImages = useCallback(
    (files: File[]) => {
      const free = MAX_IMAGES_PER_MESSAGE - controller.attachments.files.length;
      const ok: File[] = [];
      for (const f of files) {
        if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(f.type)) {
          toast.error(`«${f.name}»: поддерживаются только PNG, JPG и WebP`);
        } else if (f.size > MAX_IMAGE_INPUT_BYTES) {
          toast.error(`«${f.name}»: файл больше 20 МБ`);
        } else ok.push(f);
      }
      if (ok.length > free) {
        toast.error(`Не больше ${MAX_IMAGES_PER_MESSAGE} изображений в сообщении`);
      }
      if (ok.length && free > 0) controller.attachments.add(ok.slice(0, free));
    },
    [controller.attachments],
  );

  const addTextFiles = useCallback(async (files: File[]) => {
    const read: TextFile[] = [];
    for (const f of files) {
      if (f.size > MAX_TEXT_FILE_BYTES) {
        toast.error(`«${f.name}»: файл больше ${formatBytes(MAX_TEXT_FILE_BYTES)}`);
        continue;
      }
      try {
        const content = await f.text();
        if (content.includes("\u0000")) {
          toast.error(`«${f.name}» не похож на текстовый файл`);
          continue;
        }
        read.push({ name: f.name, content });
      } catch {
        toast.error(`Не удалось прочитать «${f.name}»`);
      }
    }
    if (!read.length) return;
    setTextFiles((prev) => {
      const next = [...prev, ...read];
      if (next.length > MAX_TEXT_FILES_PER_MESSAGE) {
        toast.error(`Не больше ${MAX_TEXT_FILES_PER_MESSAGE} файлов в сообщении`);
      }
      return next.slice(0, MAX_TEXT_FILES_PER_MESSAGE);
    });
  }, []);

  const addAny = useCallback(
    (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/"));
      const texts = files.filter((f) => !f.type.startsWith("image/") && isTextFileName(f.name));
      const other = files.filter((f) => !images.includes(f) && !texts.includes(f));
      for (const f of other) {
        toast.error(`«${f.name}»: такой тип файла не поддерживается`, {
          description:
            "Можно: PNG, JPG, WebP и текстовые файлы или код (.txt, .md, .py, .ts, .json, .csv…)",
        });
      }
      if (images.length) addImages(images);
      if (texts.length) void addTextFiles(texts);
    },
    [addImages, addTextFiles],
  );

  // Drag-and-drop anywhere in the window, with an overlay. Runs in the capture phase so
  // the prompt input's own (images-only) handlers never see the drop.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types?.includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) addAny(files);
    };
    window.addEventListener("dragenter", onEnter, true);
    window.addEventListener("dragleave", onLeave, true);
    window.addEventListener("dragover", onOver, true);
    window.addEventListener("drop", onDrop, true);
    return () => {
      window.removeEventListener("dragenter", onEnter, true);
      window.removeEventListener("dragleave", onLeave, true);
      window.removeEventListener("dragover", onOver, true);
      window.removeEventListener("drop", onDrop, true);
    };
  }, [addAny]);

  const onPasteCapture = (e: React.ClipboardEvent) => {
    const files: File[] = [];
    for (const item of Array.from(e.clipboardData?.items ?? [])) {
      if (item.kind !== "file") continue;
      const f = item.getAsFile();
      if (f) files.push(f);
    }
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    const stamp = screenshotStamp(new Date());
    addAny(
      files.map((f, i) =>
        f.type.startsWith("image/") && (!f.name || f.name === "image.png")
          ? new File(
              [f],
              `screenshot-${stamp}${files.length > 1 ? `-${i + 1}` : ""}.${f.type.split("/")[1] === "jpeg" ? "jpg" : f.type.split("/")[1]}`,
              { type: f.type },
            )
          : f,
      ),
    );
  };

  useEffect(() => {
    if (!active) textareaRef.current?.focus();
  }, [active]);

  const handleSubmit = async (message: PromptInputMessage) => {
    // Throwing keeps the typed text: PromptInput only clears after a successful submit.
    if (active || submitting) throw new Error("busy");
    setSubmitting(true);
    try {
      await send({
        conversationId,
        text: buildMessageContent(message.text, textFiles),
        files: message.files,
      });
      setTextFiles([]);
    } finally {
      setSubmitting(false);
      textareaRef.current?.focus();
    }
  };

  return (
    <div onPasteCapture={onPasteCapture}>
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-signal px-10 py-8 text-center">
            <Upload className="size-6 text-signal" />
            <p className="font-medium">Отпустите, чтобы прикрепить</p>
            <p className="text-xs text-muted-foreground">
              Изображения PNG, JPG, WebP или текстовые файлы и код
            </p>
          </div>
        </div>
      )}
      <input
        ref={textFileInput}
        type="file"
        multiple
        accept={TEXT_FILE_ACCEPT}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = "";
          if (files.length) addAny(files);
        }}
      />
      <PromptInput
        onSubmit={handleSubmit}
        accept={ALLOWED_IMAGE_TYPES.join(",")}
        multiple
        maxFiles={MAX_IMAGES_PER_MESSAGE}
        maxFileSize={MAX_IMAGE_INPUT_BYTES}
        onError={(err) => {
          toast.error(
            err.code === "accept"
              ? "Поддерживаются только PNG, JPG и WebP"
              : err.code === "max_file_size"
                ? "Файл больше 20 МБ"
                : `Не больше ${MAX_IMAGES_PER_MESSAGE} изображений в сообщении`,
          );
        }}
        className="rounded-2xl bg-composer shadow-composer [&_[data-slot=input-group]]:rounded-2xl [&_[data-slot=input-group]]:border-border [&_[data-slot=input-group]]:bg-composer"
      >
        <ComposerAttachments />
        {textFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {textFiles.map((f, i) => (
              <span
                key={`${f.name}-${i}`}
                className="flex max-w-60 items-center gap-2 rounded-lg border bg-card py-1.5 pr-1 pl-2.5 text-xs"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{f.name}</span>
                  <span className="block text-muted-foreground">
                    {formatBytes(new TextEncoder().encode(f.content).length)} ·{" "}
                    {f.content.split("\n").length} строк
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setTextFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`Убрать файл ${f.name}`}
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        <PromptInputTextarea
          ref={textareaRef}
          placeholder="Спросите Kimi… (Enter — отправить, Shift+Enter — новая строка)"
          className="min-h-[96px] px-4 pt-3.5 text-[0.95rem] leading-relaxed"
          aria-label="Сообщение"
        />
        <PromptInputFooter className="px-2 pb-2">
          <PromptInputTools>
            <AttachButton />
            <PromptInputButton
              tooltip={`Прикрепить текстовый файл или код (до ${formatBytes(MAX_TEXT_FILE_BYTES)})`}
              aria-label="Прикрепить текстовый файл"
              disabled={textFiles.length >= MAX_TEXT_FILES_PER_MESSAGE}
              onClick={() => textFileInput.current?.click()}
            >
              <Paperclip className="size-4" />
            </PromptInputButton>
            <EffortSelect />
            <span className="hidden items-center gap-1.5 whitespace-nowrap px-1.5 text-xs text-muted-foreground sm:inline-flex">
              <span className="size-1.5 rounded-full bg-signal" aria-hidden="true" />
              {MODEL_DISPLAY_NAME}
            </span>
          </PromptInputTools>
          <div className="flex items-center gap-1">
            {contentLength > 0 && (
              <span
                className={
                  tooLong
                    ? "px-1.5 font-mono text-[0.7rem] tabular-nums text-destructive"
                    : "hidden px-1.5 font-mono text-[0.7rem] tabular-nums text-muted-foreground sm:inline"
                }
                title={
                  tooLong
                    ? `Максимум ${MAX_MESSAGE_CHARS.toLocaleString("ru-RU")} символов`
                    : "Длина сообщения"
                }
              >
                {contentLength.toLocaleString("ru-RU")} симв.
              </span>
            )}
            <ClearButton hasFiles={textFiles.length > 0} onClearFiles={() => setTextFiles([])} />
            <SubmitControl
              conversationId={conversationId}
              submitting={submitting}
              hasFiles={textFiles.length > 0}
              tooLong={tooLong}
            />
          </div>
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}

export function Composer({ conversationId }: { conversationId: string | null }) {
  return (
    <PromptInputProvider key={conversationId ?? "new"}>
      <ComposerInner conversationId={conversationId} autoFocusKey={conversationId ?? "new"} />
    </PromptInputProvider>
  );
}
