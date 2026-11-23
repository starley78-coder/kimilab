import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  FileDown,
  FileJson,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import { useCallback } from "react";
import { toast } from "sonner";

import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import {
  conversationQuery,
  conversationsQuery,
  loadConversationExport,
  updateConversation,
  type ConversationRow,
} from "@/lib/chat/data";
import {
  conversationToJson,
  conversationToMarkdown,
  downloadText,
  safeFileName,
} from "@/lib/chat/export";

export function useConversationActions() {
  const queryClient = useQueryClient();

  const patch = useCallback(
    async (
      c: ConversationRow,
      change: Partial<Pick<ConversationRow, "is_pinned" | "is_archived" | "system_prompt">>,
      done: string,
    ) => {
      const apply = (row: ConversationRow) => (row.id === c.id ? { ...row, ...change } : row);
      queryClient.setQueryData<ConversationRow[]>(conversationsQuery().queryKey, (old) =>
        old?.map(apply),
      );
      queryClient.setQueryData<ConversationRow | null>(conversationQuery(c.id).queryKey, (old) =>
        old ? apply(old) : old,
      );
      try {
        await updateConversation(c.id, change);
        toast.success(done);
      } catch (e) {
        toast.error("Не удалось сохранить", {
          description: e instanceof Error ? e.message : undefined,
        });
      } finally {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: conversationsQuery().queryKey }),
          queryClient.invalidateQueries({ queryKey: conversationQuery(c.id).queryKey }),
        ]);
      }
    },
    [queryClient],
  );

  const exportAs = useCallback(async (c: ConversationRow, format: "md" | "json") => {
    try {
      const { conversation, messages } = await loadConversationExport(c.id);
      const name = safeFileName(conversation.title);
      if (format === "md") {
        downloadText(
          `${name}.md`,
          conversationToMarkdown(conversation, messages),
          "text/markdown;charset=utf-8",
        );
      } else {
        downloadText(
          `${name}.json`,
          JSON.stringify(conversationToJson(conversation, messages), null, 2),
          "application/json",
        );
      }
    } catch (e) {
      toast.error("Экспорт не удался", { description: e instanceof Error ? e.message : undefined });
    }
  }, []);

  return {
    togglePin: (c: ConversationRow) =>
      patch(c, { is_pinned: !c.is_pinned }, c.is_pinned ? "Диалог откреплён" : "Диалог закреплён"),
    toggleArchive: (c: ConversationRow) =>
      patch(
        c,
        c.is_archived ? { is_archived: false } : { is_archived: true, is_pinned: false },
        c.is_archived ? "Диалог возвращён из архива" : "Диалог перенесён в архив",
      ),
    setSystemPrompt: (c: ConversationRow, prompt: string | null) =>
      patch(
        c,
        { system_prompt: prompt },
        prompt === null ? "Используется инструкция по умолчанию" : "Инструкция диалога сохранена",
      ),
    exportAs,
  };
}

/** Shared menu items for a conversation (sidebar and thread header). */
export function ConversationMenuItems({
  conversation,
  onRename,
  onDelete,
}: {
  conversation: ConversationRow;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { togglePin, toggleArchive, exportAs } = useConversationActions();
  return (
    <>
      <DropdownMenuItem onSelect={onRename}>
        <Pencil /> Переименовать
      </DropdownMenuItem>
      {!conversation.is_archived && (
        <DropdownMenuItem onSelect={() => void togglePin(conversation)}>
          {conversation.is_pinned ? <PinOff /> : <Pin />}
          {conversation.is_pinned ? "Открепить" : "Закрепить"}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onSelect={() => void toggleArchive(conversation)}>
        {conversation.is_archived ? <ArchiveRestore /> : <Archive />}
        {conversation.is_archived ? "Вернуть из архива" : "В архив"}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => void exportAs(conversation, "md")}>
        <FileDown /> Экспорт в Markdown
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void exportAs(conversation, "json")}>
        <FileJson /> Экспорт в JSON
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
        <Trash2 /> Удалить
      </DropdownMenuItem>
    </>
  );
}
