import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";
import { MessageSquareX, MoreHorizontal, Pencil, Send, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { ChatHeader } from "@/components/chat/chat-header";
import { useChatRuntime, useLiveTurn } from "@/components/chat/chat-runtime";
import { Composer } from "@/components/chat/composer";
import { DeleteConversationDialog, RenameConversationDialog } from "@/components/chat/conversation-dialogs";
import { ErrorCard } from "@/components/chat/error-card";
import { AssistantMessage, LiveAssistant, UserMessage } from "@/components/chat/message-item";
import { useSettings } from "@/components/chat/settings-context";
import { ConversationUsage } from "@/components/chat/usage";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { attachmentsOf, conversationQuery, messagesQuery, type ConversationRow } from "@/lib/chat/data";

export const Route = createFileRoute("/_authenticated/chat/$conversationId")({
  loader: async ({ context, params }) => {
    const [conversation] = await Promise.all([
      context.queryClient.ensureQueryData(conversationQuery(params.conversationId)),
      context.queryClient.ensureQueryData(messagesQuery(params.conversationId)),
    ]);
    return { title: conversation?.title ?? null };
  },
  head: ({ loaderData }) => {
    const title = loaderData?.title ? `${loaderData.title} — Kimi Lab` : "Диалог — Kimi Lab";
    return {
      meta: [
        { title },
        { name: "description", content: "Диалог с Kimi K3.1 Pro." },
        { property: "og:title", content: title },
        { property: "og:description", content: "Диалог с Kimi K3.1 Pro." },
        { property: "og:type", content: "article" },
        { name: "twitter:card", content: "summary" },
        { name: "robots", content: "noindex" },
      ],
    };
  },
  pendingComponent: ThreadPending,
  errorComponent: ThreadError,
  component: ThreadPage,
});

function ThreadPending() {
  return (
    <>
      <ChatHeader />
      <div className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8">
        <Skeleton className="ml-auto h-10 w-2/5 rounded-2xl" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      </div>
    </>
  );
}

function ThreadError({ error, reset }: ErrorComponentProps) {
  return (
    <>
      <ChatHeader />
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <ErrorCard
          error={{
            source: "app",
            status: 0,
            code: "load_failed",
            title: "Не удалось загрузить диалог",
            message: error instanceof Error ? error.message : String(error),
          }}
          onRetry={reset}
        />
      </div>
    </>
  );
}

function ThreadPage() {
  const { conversationId } = Route.useParams();
  return <ThreadView key={conversationId} conversationId={conversationId} />;
}

function ThreadActions({ conversation }: { conversation: ConversationRow }) {
  const [renaming, setRenaming] = useState<ConversationRow | null>(null);
  const [deleting, setDeleting] = useState<ConversationRow | null>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="quiet" size="icon-sm" aria-label="Действия с диалогом">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={() => setRenaming(conversation)}>
            <Pencil /> Переименовать
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setDeleting(conversation)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 /> Удалить
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RenameConversationDialog conversation={renaming} onOpenChange={(o) => !o && setRenaming(null)} />
      <DeleteConversationDialog conversation={deleting} onOpenChange={(o) => !o && setDeleting(null)} />
    </>
  );
}

function ThreadView({ conversationId }: { conversationId: string }) {
  const { data: messages } = useSuspenseQuery(messagesQuery(conversationId));
  const { data: conversation } = useSuspenseQuery(conversationQuery(conversationId));
  const turn = useLiveTurn(conversationId);
  const { retry, resend, dismiss } = useChatRuntime();
  const { openSettings } = useSettings();

  if (!conversation && !turn) {
    return (
      <>
        <ChatHeader />
        <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
          <MessageSquareX className="size-8 text-muted-foreground" />
          <h2 className="mt-3 font-medium">Диалог не найден</h2>
          <p className="mt-1 text-sm text-muted-foreground">Возможно, он был удалён.</p>
          <Button asChild variant="outline" className="mt-5">
            <Link to="/chat">Новый диалог</Link>
          </Button>
        </div>
      </>
    );
  }

  const ids = new Set(messages.map((m) => m.id));
  const showOptimisticUser = !!turn && !ids.has(turn.userMessage.id);
  const showLiveAssistant = !!turn && !ids.has(turn.assistantMessageId);
  const last = messages.at(-1);
  const dangling = !turn && last?.role === "user";

  return (
    <>
      <ChatHeader title={conversation?.title ?? "Новый диалог"}>
        <ConversationUsage messages={messages} />
        {conversation && <ThreadActions conversation={conversation} />}
      </ChatHeader>

      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl gap-7 px-4 pt-6 pb-10">
          {messages.map((m) =>
            m.role === "user" ? (
              <UserMessage key={m.id} content={m.content} attachments={attachmentsOf(m)} />
            ) : (
              <AssistantMessage key={m.id} row={m} />
            ),
          )}

          {showOptimisticUser && turn && (
            <UserMessage
              content={turn.userMessage.content}
              attachments={turn.userMessage.attachments}
              previews={turn.userMessage.previews}
            />
          )}
          {showLiveAssistant && turn && <LiveAssistant turn={turn} />}

          {turn?.status === "error" && turn.error && (
            <ErrorCard
              error={turn.error}
              onRetry={turn.request ? () => retry(conversationId) : undefined}
              onDismiss={() => dismiss(conversationId)}
              onOpenSettings={openSettings}
            />
          )}

          {dangling && last && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-3 text-sm">
              <span className="text-muted-foreground">Ответ на последнее сообщение не получен.</span>
              <Button size="sm" variant="outline" onClick={() => resend(conversationId, last)}>
                <Send /> Отправить повторно
              </Button>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton aria-label="Прокрутить вниз" />
      </Conversation>

      <div className="shrink-0 px-3 pb-3 sm:px-4 sm:pb-4">
        <div className="mx-auto max-w-3xl">
          <Composer conversationId={conversationId} />
          <p className="mt-2 text-center text-[0.7rem] text-muted-foreground">
            Kimi может ошибаться — проверяйте важные факты.
          </p>
        </div>
      </div>
    </>
  );
}
