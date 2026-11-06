import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { FileUIPart } from "ai";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  conversationsQuery,
  createConversation,
  messagesQuery,
  saveStoppedReply,
  uploadImage,
  type ConversationRow,
  type MessageRow,
} from "@/lib/chat/data";
import { dataUrlToBlob, prepareImage } from "@/lib/chat/images";
import {
  MAX_IMAGES_PER_MESSAGE,
  deriveTitle,
  extensionForType,
  parseStoredAttachments,
  type ChatRequestBody,
  type StoredAttachment,
} from "@/lib/chat/schema";
import { StreamAbortedError, streamChat } from "@/lib/chat/stream-client";
import type { ReasoningEffort } from "@/lib/kimi/config";
import type { ChatError } from "@/lib/kimi/errors";
import type { Usage } from "@/lib/kimi/sse";
import { readReasoningEffort } from "@/lib/preferences";

export type TurnStatus = "uploading" | "submitted" | "streaming" | "error" | "finalizing";
export type TurnPhase = "connecting" | "thinking" | "answering";

export interface LiveTurn {
  conversationId: string;
  request: ChatRequestBody | null;
  userMessage: {
    id: string;
    content: string;
    attachments: StoredAttachment[];
    previews: { url: string; name: string; mediaType: string }[];
  };
  assistantMessageId: string;
  status: TurnStatus;
  phase: TurnPhase;
  text: string;
  startedAt: number;
  phaseStartedAt: number;
  usage: Usage | null;
  error: ChatError | null;
  model: string | null;
  /** True once the server reported the reply as saved (or partially saved). */
  committed: boolean;
  mode: "stream" | "full" | null;
}

class TurnStore {
  private turns = new Map<string, LiveTurn>();
  private listeners = new Set<() => void>();
  private snapshot: ReadonlyMap<string, LiveTurn> = new Map();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  get(id: string) {
    return this.turns.get(id);
  }

  set(id: string, turn: LiveTurn) {
    this.turns.set(id, turn);
    this.commit();
  }

  patch(id: string, patch: Partial<LiveTurn> | ((t: LiveTurn) => Partial<LiveTurn>)) {
    const current = this.turns.get(id);
    if (!current) return;
    const next = { ...current, ...(typeof patch === "function" ? patch(current) : patch) };
    this.turns.set(id, next);
    this.commit();
  }

  delete(id: string) {
    const t = this.turns.get(id);
    if (t) for (const p of t.userMessage.previews) URL.revokeObjectURL(p.url);
    this.turns.delete(id);
    this.commit();
  }

  private commit() {
    this.snapshot = new Map(this.turns);
    for (const l of this.listeners) l();
  }
}

export interface SendInput {
  conversationId: string | null;
  text: string;
  files: FileUIPart[];
}

interface ChatRuntimeValue {
  store: TurnStore;
  send: (input: SendInput) => Promise<void>;
  stop: (conversationId: string) => void;
  retry: (conversationId: string) => void;
  resend: (conversationId: string, message: MessageRow) => void;
  dismiss: (conversationId: string) => void;
}

const ChatRuntimeContext = createContext<ChatRuntimeValue | null>(null);

function isActive(turn: LiveTurn | undefined) {
  return !!turn && (turn.status === "uploading" || turn.status === "submitted" || turn.status === "streaming");
}

export function ChatRuntimeProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const storeRef = useRef<TurnStore | null>(null);
  if (!storeRef.current) storeRef.current = new TurnStore();
  const store = storeRef.current;
  const controllers = useRef(new Map<string, AbortController>());
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const refreshConversation = useCallback(
    async (conversationId: string) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: messagesQuery(conversationId).queryKey }),
        queryClient.invalidateQueries({ queryKey: conversationsQuery().queryKey }),
      ]);
    },
    [queryClient],
  );

  const runTurn = useCallback(
    async (conversationId: string, request: ChatRequestBody) => {
      const controller = new AbortController();
      controllers.current.set(conversationId, controller);
      store.patch(conversationId, {
        request,
        assistantMessageId: request.assistantMessageId,
        status: "submitted",
        phase: "connecting",
        text: "",
        usage: null,
        error: null,
        committed: false,
        startedAt: Date.now(),
        phaseStartedAt: Date.now(),
      });

      let sawError = false;
      try {
        await streamChat(request, {
          signal: controller.signal,
          onEvent: (event) => {
            switch (event.type) {
              case "start":
                store.patch(conversationId, { model: event.model, mode: event.mode });
                break;
              case "phase":
                store.patch(conversationId, { status: "streaming", phase: event.phase, phaseStartedAt: Date.now() });
                break;
              case "delta":
                store.patch(conversationId, (t) => ({
                  status: "streaming",
                  phase: "answering",
                  text: t.text + event.text,
                }));
                break;
              case "usage":
                store.patch(conversationId, { usage: event.usage });
                break;
              case "done":
                store.patch(conversationId, { committed: event.saved, status: "finalizing", usage: event.usage });
                break;
              case "error":
                sawError = true;
                store.patch(conversationId, { status: "error", error: event.error });
                break;
            }
          },
        });
      } catch (e) {
        if (!(e instanceof StreamAbortedError)) {
          sawError = true;
          store.patch(conversationId, {
            status: "error",
            error: {
              source: "app",
              status: 0,
              code: "client_error",
              title: "Ошибка в браузере",
              message: e instanceof Error ? e.message : "Неизвестная ошибка",
            },
          });
        }
        return;
      } finally {
        if (controllers.current.get(conversationId) === controller) controllers.current.delete(conversationId);
      }

      await refreshConversation(conversationId);
      const turn = store.get(conversationId);
      if (!sawError && turn && turn.status !== "error") store.delete(conversationId);
    },
    [store, refreshConversation],
  );

  const send = useCallback(
    async ({ conversationId: existingId, text, files }: SendInput) => {
      const content = text.trim();
      if (!content && files.length === 0) return;
      if (files.length > MAX_IMAGES_PER_MESSAGE) {
        toast.error(`Можно прикрепить не больше ${MAX_IMAGES_PER_MESSAGE} изображений`);
        throw new Error("too many files");
      }
      if (existingId && isActive(store.get(existingId))) {
        toast.message("Дождитесь завершения текущего ответа или остановите его");
        throw new Error("busy");
      }

      // Prepare images before anything is created so validation errors keep the input intact.
      let prepared: Awaited<ReturnType<typeof prepareImage>>[] = [];
      try {
        prepared = await Promise.all(
          files.map(async (f) => prepareImage(await dataUrlToBlob(f.url), f.filename || "image")),
        );
      } catch (e) {
        toast.error("Изображение не подходит", { description: e instanceof Error ? e.message : undefined });
        throw e;
      }

      const conversationId = existingId ?? crypto.randomUUID();
      const userMessageId = crypto.randomUUID();
      const assistantMessageId = crypto.randomUUID();
      const effort: ReasoningEffort = readReasoningEffort();

      if (!existingId) {
        try {
          const row = await createConversation(conversationId, deriveTitle(content, prepared.length > 0));
          queryClient.setQueryData<ConversationRow[]>(conversationsQuery().queryKey, (old) => [row, ...(old ?? [])]);
          queryClient.setQueryData(["conversation", conversationId], row);
          queryClient.setQueryData<MessageRow[]>(messagesQuery(conversationId).queryKey, []);
        } catch (e) {
          toast.error("Не удалось создать диалог", { description: e instanceof Error ? e.message : undefined });
          throw e;
        }
      }

      const previews = prepared.map((p) => ({
        url: URL.createObjectURL(p.blob),
        name: p.name,
        mediaType: p.mediaType,
      }));

      store.set(conversationId, {
        conversationId,
        request: null,
        userMessage: { id: userMessageId, content, attachments: [], previews },
        assistantMessageId,
        status: prepared.length ? "uploading" : "submitted",
        phase: "connecting",
        text: "",
        startedAt: Date.now(),
        phaseStartedAt: Date.now(),
        usage: null,
        error: null,
        model: null,
        committed: false,
        mode: null,
      });

      if (!existingId) {
        void navigate({ to: "/chat/$conversationId", params: { conversationId } });
      }

      let attachments: StoredAttachment[] = [];
      try {
        attachments = await Promise.all(
          prepared.map(async (p) => {
            const path = `${userId}/${conversationId}/${crypto.randomUUID()}.${extensionForType(p.mediaType)}`;
            await uploadImage(path, p.blob, p.mediaType);
            return {
              path,
              name: p.name.slice(0, 200),
              mediaType: p.mediaType,
              size: p.blob.size,
              width: p.width,
              height: p.height,
            };
          }),
        );
      } catch (e) {
        store.patch(conversationId, {
          status: "error",
          error: {
            source: "app",
            status: 0,
            code: "upload_failed",
            title: "Не удалось загрузить изображение",
            message: e instanceof Error ? e.message : "Ошибка загрузки",
          },
        });
        return;
      }

      store.patch(conversationId, (t) => ({ userMessage: { ...t.userMessage, attachments } }));
      void runTurn(conversationId, {
        conversationId,
        userMessageId,
        assistantMessageId,
        content,
        attachments,
        reasoningEffort: effort,
      });
    },
    [store, queryClient, navigate, runTurn, userId],
  );

  const stop = useCallback(
    (conversationId: string) => {
      const turn = store.get(conversationId);
      controllers.current.get(conversationId)?.abort();
      controllers.current.delete(conversationId);
      if (!turn) return;
      store.patch(conversationId, { status: "finalizing" });
      void (async () => {
        try {
          if (turn.text.trim() && turn.request) {
            await saveStoppedReply({
              id: turn.assistantMessageId,
              conversationId,
              userId,
              content: turn.text,
              model: turn.model,
              reasoningEffort: turn.request.reasoningEffort,
            });
          }
        } catch (e) {
          toast.error("Не удалось сохранить остановленный ответ", {
            description: e instanceof Error ? e.message : undefined,
          });
        }
        await refreshConversation(conversationId);
        store.delete(conversationId);
      })();
    },
    [store, userId, refreshConversation],
  );

  const retry = useCallback(
    (conversationId: string) => {
      const turn = store.get(conversationId);
      if (!turn?.request) return;
      void runTurn(conversationId, {
        ...turn.request,
        assistantMessageId: crypto.randomUUID(),
        reasoningEffort: readReasoningEffort(),
      });
    },
    [store, runTurn],
  );

  const resend = useCallback(
    (conversationId: string, message: MessageRow) => {
      if (isActive(store.get(conversationId))) return;
      const assistantMessageId = crypto.randomUUID();
      const attachments = parseStoredAttachments(message.attachments);
      store.set(conversationId, {
        conversationId,
        request: null,
        userMessage: { id: message.id, content: message.content, attachments, previews: [] },
        assistantMessageId,
        status: "submitted",
        phase: "connecting",
        text: "",
        startedAt: Date.now(),
        phaseStartedAt: Date.now(),
        usage: null,
        error: null,
        model: null,
        committed: false,
        mode: null,
      });
      void runTurn(conversationId, {
        conversationId,
        userMessageId: message.id,
        assistantMessageId,
        content: message.content,
        attachments,
        reasoningEffort: readReasoningEffort(),
      });
    },
    [store, runTurn],
  );

  const dismiss = useCallback(
    (conversationId: string) => {
      void refreshConversation(conversationId).then(() => store.delete(conversationId));
    },
    [store, refreshConversation],
  );

  const value = useMemo(
    () => ({ store, send, stop, retry, resend, dismiss }),
    [store, send, stop, retry, resend, dismiss],
  );

  return <ChatRuntimeContext.Provider value={value}>{children}</ChatRuntimeContext.Provider>;
}

export function useChatRuntime() {
  const ctx = useContext(ChatRuntimeContext);
  if (!ctx) throw new Error("useChatRuntime must be used inside ChatRuntimeProvider");
  return ctx;
}

export function useLiveTurns(): ReadonlyMap<string, LiveTurn> {
  const { store } = useChatRuntime();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useLiveTurn(conversationId: string | null): LiveTurn | undefined {
  const turns = useLiveTurns();
  return conversationId ? turns.get(conversationId) : undefined;
}

export function isTurnActive(turn: LiveTurn | undefined) {
  return isActive(turn);
}

export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}
