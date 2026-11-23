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
  deleteConversation,
  deleteEmptyStoppedReplies,
  deleteMessagesFrom,
  messagesQuery,
  updateMessageContent,
  saveStoppedReply,
  uploadImage,
  type ConversationRow,
  type MessageRow,
} from "@/lib/chat/data";
import { dataUrlToBlob, prepareImage } from "@/lib/chat/images";
import {
  IMAGE_BUCKET,
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
import type { SourceReference, ToolRunStatus } from "@/lib/tools/types";

export type TurnStatus = "uploading" | "submitted" | "streaming" | "error" | "finalizing";
export type TurnPhase = "connecting" | "thinking" | "answering" | "full" | "analyzing";

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
  /** True once the server confirmed the user message is stored and generation began. */
  started: boolean;
  /** Stop was pressed before the server confirmed the start; it is applied as soon as it does. */
  stopRequested: boolean;
  /** Real tool runs and sources reported by the server for this reply only. */
  toolRuns: ToolRunStatus[];
  sources: SourceReference[];
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
  searchEnabled?: boolean;
}

interface ChatRuntimeValue {
  store: TurnStore;
  send: (input: SendInput) => Promise<void>;
  stop: (conversationId: string) => void;
  /** Drops a running turn without saving anything (used when the conversation is deleted). */
  abandon: (conversationId: string) => void;
  retry: (conversationId: string) => void;
  resend: (conversationId: string, message: MessageRow) => void;
  /** Drops every reply after this question and asks again. */
  regenerate: (conversationId: string, question: MessageRow) => Promise<void>;
  /** Replaces the question text, drops everything after it and asks again. */
  editAndResend: (conversationId: string, question: MessageRow, content: string) => Promise<void>;
  dismiss: (conversationId: string) => void;
}

const ChatRuntimeContext = createContext<ChatRuntimeValue | null>(null);

function isActive(turn: LiveTurn | undefined) {
  return (
    !!turn &&
    (turn.status === "uploading" || turn.status === "submitted" || turn.status === "streaming")
  );
}

export function ChatRuntimeProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const storeRef = useRef<TurnStore | null>(null);
  if (!storeRef.current) storeRef.current = new TurnStore();
  const store = storeRef.current;
  const controllers = useRef(new Map<string, AbortController>());
  const pendingStops = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const performStopRef = useRef<(conversationId: string) => void>(() => undefined);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const refreshConversation = useCallback(
    async (conversationId: string) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: messagesQuery(conversationId).queryKey }),
        queryClient.invalidateQueries({ queryKey: conversationsQuery().queryKey }),
        queryClient.invalidateQueries({ queryKey: ["kimi-balance"] }),
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
        started: false,
        stopRequested: false,
        toolRuns: [],
        sources: [],
        startedAt: Date.now(),
        phaseStartedAt: Date.now(),
      });

      let sawError = false;
      try {
        await streamChat(request, {
          signal: controller.signal,
          onEvent: (event) => {
            switch (event.type) {
              case "start": {
                store.patch(conversationId, { model: event.model, started: true });
                const pending = pendingStops.current.get(conversationId);
                if (pending !== undefined) {
                  clearTimeout(pending);
                  pendingStops.current.delete(conversationId);
                  performStopRef.current(conversationId);
                }
                break;
              }
              case "phase":
                store.patch(conversationId, {
                  status: event.phase === "full" ? "submitted" : "streaming",
                  phase: event.phase,
                  phaseStartedAt: Date.now(),
                });
                break;
              case "delta":
                store.patch(conversationId, (t) => ({
                  status: "streaming",
                  phase: "answering",
                  text: t.text + event.text,
                }));
                break;
              case "tool":
                store.patch(conversationId, (t) => ({
                  toolRuns: [...t.toolRuns.filter((r) => r.id !== event.run.id), event.run],
                }));
                break;
              case "sources":
                store.patch(conversationId, { sources: event.sources });
                break;
              case "usage":
                store.patch(conversationId, { usage: event.usage });
                break;
              case "done":
                store.patch(conversationId, {
                  committed: event.saved,
                  status: "finalizing",
                  usage: event.usage,
                });
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
        if (controllers.current.get(conversationId) === controller)
          controllers.current.delete(conversationId);
        const pending = pendingStops.current.get(conversationId);
        if (pending !== undefined) {
          clearTimeout(pending);
          pendingStops.current.delete(conversationId);
        }
      }

      await refreshConversation(conversationId);
      const turn = store.get(conversationId);
      if (!sawError && turn && turn.status !== "error") store.delete(conversationId);
    },
    [store, refreshConversation],
  );

  const send = useCallback(
    async ({ conversationId: existingId, text, files, searchEnabled = false }: SendInput) => {
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
        toast.error("Изображение не подходит", {
          description: e instanceof Error ? e.message : undefined,
        });
        throw e;
      }

      const conversationId = existingId ?? crypto.randomUUID();
      const userMessageId = crypto.randomUUID();
      const assistantMessageId = crypto.randomUUID();
      const effort: ReasoningEffort = readReasoningEffort();

      if (!existingId) {
        try {
          const row = await createConversation(
            conversationId,
            deriveTitle(content, prepared.length > 0),
          );
          queryClient.setQueryData<ConversationRow[]>(conversationsQuery().queryKey, (old) => [
            row,
            ...(old ?? []),
          ]);
          queryClient.setQueryData(["conversation", conversationId], row);
          queryClient.setQueryData<MessageRow[]>(messagesQuery(conversationId).queryKey, []);
        } catch (e) {
          toast.error("Не удалось создать диалог", {
            description: e instanceof Error ? e.message : undefined,
          });
          throw e;
        }
      }

      const previews = prepared.map((p) => ({
        url: URL.createObjectURL(p.blob),
        name: p.name,
        mediaType: p.mediaType,
      }));

      const makeTurn = (attachments: StoredAttachment[], status: TurnStatus): LiveTurn => ({
        conversationId,
        request: null,
        userMessage: { id: userMessageId, content, attachments, previews },
        assistantMessageId,
        status,
        phase: "connecting",
        text: "",
        startedAt: Date.now(),
        phaseStartedAt: Date.now(),
        usage: null,
        error: null,
        model: null,
        committed: false,
        started: false,
        stopRequested: false,
        toolRuns: [],
        sources: [],
      });

      // Existing thread: show the message right away while images upload.
      if (existingId)
        store.set(conversationId, makeTurn([], prepared.length ? "uploading" : "submitted"));

      const uploads = await Promise.allSettled(
        prepared.map(async (p): Promise<StoredAttachment> => {
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
      const failed = uploads.find((u): u is PromiseRejectedResult => u.status === "rejected");
      const attachments = uploads
        .filter((u): u is PromiseFulfilledResult<StoredAttachment> => u.status === "fulfilled")
        .map((u) => u.value);
      if (failed) {
        // Keep the composer input intact: undo everything and surface the error.
        if (attachments.length) {
          void supabase.storage.from(IMAGE_BUCKET).remove(attachments.map((a) => a.path));
        }
        for (const p of previews) URL.revokeObjectURL(p.url);
        if (existingId) {
          store.delete(conversationId);
        } else {
          void deleteConversation(conversationId).catch(() => undefined);
          queryClient.setQueryData<ConversationRow[]>(conversationsQuery().queryKey, (old) =>
            (old ?? []).filter((c) => c.id !== conversationId),
          );
        }
        const reason = failed.reason instanceof Error ? failed.reason.message : "Ошибка загрузки";
        toast.error("Не удалось загрузить изображение", { description: reason });
        throw failed.reason;
      }

      if (existingId) {
        store.patch(conversationId, (t) => ({ userMessage: { ...t.userMessage, attachments } }));
      } else {
        store.set(conversationId, makeTurn(attachments, "submitted"));
        void navigate({ to: "/chat/$conversationId", params: { conversationId } });
      }

      void runTurn(conversationId, {
        conversationId,
        userMessageId,
        assistantMessageId,
        content,
        attachments,
        reasoningEffort: effort,
        search_enabled: searchEnabled,
      });
    },
    [store, queryClient, navigate, runTurn, userId],
  );

  const performStop = useCallback(
    (conversationId: string) => {
      const turn = store.get(conversationId);
      controllers.current.get(conversationId)?.abort();
      controllers.current.delete(conversationId);
      if (!turn) return;
      store.patch(conversationId, { status: "finalizing" });
      void (async () => {
        try {
          // Storing the stopped reply (even an empty one) is also the signal that makes
          // the server cancel the request at the provider.
          if (turn.request && turn.started && !turn.committed) {
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
  performStopRef.current = performStop;

  const stop = useCallback(
    (conversationId: string) => {
      const turn = store.get(conversationId);
      if (!turn || !isActive(turn)) return;
      if (turn.request && !turn.started) {
        // The server has not confirmed the start yet: stop as soon as it does (or after a short wait).
        if (pendingStops.current.has(conversationId)) return;
        store.patch(conversationId, { stopRequested: true });
        pendingStops.current.set(
          conversationId,
          setTimeout(() => {
            pendingStops.current.delete(conversationId);
            performStop(conversationId);
          }, 6000),
        );
        return;
      }
      performStop(conversationId);
    },
    [store, performStop],
  );

  const abandon = useCallback(
    (conversationId: string) => {
      const pending = pendingStops.current.get(conversationId);
      if (pending !== undefined) {
        clearTimeout(pending);
        pendingStops.current.delete(conversationId);
      }
      controllers.current.get(conversationId)?.abort();
      controllers.current.delete(conversationId);
      store.delete(conversationId);
    },
    [store],
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
        started: false,
        stopRequested: false,
        toolRuns: [],
        sources: [],
      });
      // A reply that was stopped before any text arrived is only a marker: replace it.
      void deleteEmptyStoppedReplies(conversationId)
        .catch(() => undefined)
        .then(() =>
          queryClient.invalidateQueries({ queryKey: messagesQuery(conversationId).queryKey }),
        );
      void runTurn(conversationId, {
        conversationId,
        userMessageId: message.id,
        assistantMessageId,
        content: message.content,
        attachments,
        reasoningEffort: readReasoningEffort(),
        // keep the original choice of the question being resent
        search_enabled: message.search_enabled,
      });
    },
    [store, runTurn, queryClient],
  );

  const truncateAfter = useCallback(
    async (conversationId: string, question: MessageRow) => {
      await deleteMessagesFrom(conversationId, question.seq, false);
      queryClient.setQueryData<MessageRow[]>(messagesQuery(conversationId).queryKey, (old) =>
        (old ?? []).filter((m) => m.seq <= question.seq),
      );
    },
    [queryClient],
  );

  const regenerate = useCallback(
    async (conversationId: string, question: MessageRow) => {
      if (isActive(store.get(conversationId))) return;
      try {
        await truncateAfter(conversationId, question);
      } catch (e) {
        toast.error("Не удалось подготовить повтор", {
          description: e instanceof Error ? e.message : undefined,
        });
        return;
      }
      window.__lovableEvents?.track?.("project.reply_regenerated", {});
      resend(conversationId, question);
    },
    [store, truncateAfter, resend],
  );

  const editAndResend = useCallback(
    async (conversationId: string, question: MessageRow, content: string) => {
      if (isActive(store.get(conversationId))) return;
      const clean = content.trim();
      if (!clean && parseStoredAttachments(question.attachments).length === 0) {
        toast.error("Сообщение не может быть пустым");
        throw new Error("empty");
      }
      try {
        await truncateAfter(conversationId, question);
        if (clean !== question.content) await updateMessageContent(question.id, clean);
      } catch (e) {
        toast.error("Не удалось изменить сообщение", {
          description: e instanceof Error ? e.message : undefined,
        });
        throw e;
      }
      const updated = { ...question, content: clean };
      queryClient.setQueryData<MessageRow[]>(messagesQuery(conversationId).queryKey, (old) =>
        (old ?? []).map((m) => (m.id === question.id ? updated : m)),
      );
      resend(conversationId, updated);
    },
    [store, truncateAfter, resend, queryClient],
  );

  const dismiss = useCallback(
    (conversationId: string) => {
      void refreshConversation(conversationId).then(() => store.delete(conversationId));
    },
    [store, refreshConversation],
  );

  const value = useMemo(
    () => ({ store, send, stop, abandon, retry, resend, regenerate, editAndResend, dismiss }),
    [store, send, stop, abandon, retry, resend, regenerate, editAndResend, dismiss],
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
