import { Eraser, ImagePlus } from "lucide-react";
import { useEffect, useRef } from "react";
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
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_INPUT_BYTES, MAX_IMAGES_PER_MESSAGE } from "@/lib/chat/schema";
import {
  MODEL_DISPLAY_NAME,
  REASONING_EFFORTS,
  REASONING_EFFORT_HINTS,
  REASONING_EFFORT_LABELS,
  isReasoningEffort,
} from "@/lib/kimi/config";
import { useReasoningEffort } from "@/lib/preferences";

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
      tooltip={full ? `Не больше ${MAX_IMAGES_PER_MESSAGE} изображений` : "Прикрепить изображение (PNG, JPG, WebP)"}
      onClick={() => attachments.openFileDialog()}
      disabled={full}
      aria-label="Прикрепить изображение"
    >
      <ImagePlus className="size-4" />
    </PromptInputButton>
  );
}

function ClearButton() {
  const controller = usePromptInputController();
  const empty = !controller.textInput.value && controller.attachments.files.length === 0;
  return (
    <PromptInputButton
      tooltip="Очистить поле"
      aria-label="Очистить поле"
      disabled={empty}
      onClick={() => {
        controller.textInput.clear();
        controller.attachments.clear();
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
        <span className="text-muted-foreground">Рассуждения</span>
        <PromptInputSelectValue />
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

function SubmitControl({ conversationId }: { conversationId: string | null }) {
  const controller = usePromptInputController();
  const turn = useLiveTurn(conversationId);
  const { stop } = useChatRuntime();
  const active = isTurnActive(turn);
  const status = !active ? undefined : turn?.status === "streaming" ? "streaming" : "submitted";
  const empty = !controller.textInput.value.trim() && controller.attachments.files.length === 0;
  return (
    <PromptInputSubmit
      status={status}
      onStop={conversationId ? () => stop(conversationId) : undefined}
      disabled={!active && empty}
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

  useEffect(() => {
    textareaRef.current?.focus();
  }, [autoFocusKey]);

  useEffect(() => {
    if (!active) textareaRef.current?.focus();
  }, [active]);

  const handleSubmit = async (message: PromptInputMessage) => {
    if (active) return;
    await send({ conversationId, text: message.text, files: message.files });
    textareaRef.current?.focus();
  };

  return (
    <PromptInput
      onSubmit={handleSubmit}
      accept={ALLOWED_IMAGE_TYPES.join(",")}
      multiple
      globalDrop
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
      <PromptInputTextarea
        ref={textareaRef}
        placeholder="Спросите Kimi… (Enter — отправить, Shift+Enter — новая строка)"
        className="min-h-[72px] px-4 pt-3.5 text-[0.95rem] leading-relaxed"
        aria-label="Сообщение"
      />
      <PromptInputFooter className="px-2 pb-2">
        <PromptInputTools>
          <AttachButton />
          <EffortSelect />
          <span className="hidden items-center gap-1.5 px-1.5 text-xs text-muted-foreground sm:inline-flex">
            <span className="size-1.5 rounded-full bg-signal" aria-hidden="true" />
            {MODEL_DISPLAY_NAME}
          </span>
        </PromptInputTools>
        <div className="flex items-center gap-1">
          <ClearButton />
          <SubmitControl conversationId={conversationId} />
        </div>
      </PromptInputFooter>
    </PromptInput>
  );
}

export function Composer({ conversationId }: { conversationId: string | null }) {
  return (
    <PromptInputProvider key={conversationId ?? "new"}>
      <ComposerInner conversationId={conversationId} autoFocusKey={conversationId ?? "new"} />
    </PromptInputProvider>
  );
}
