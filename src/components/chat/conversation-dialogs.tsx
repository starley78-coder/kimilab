import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { useChatRuntime } from "@/components/chat/chat-runtime";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  conversationsQuery,
  deleteConversation,
  renameConversation,
  type ConversationRow,
} from "@/lib/chat/data";

export function RenameConversationDialog({
  conversation,
  onOpenChange,
}: {
  conversation: Pick<ConversationRow, "id" | "title"> | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (conversation) setTitle(conversation.title);
  }, [conversation]);

  const mutation = useMutation({
    mutationFn: (input: { id: string; title: string }) => renameConversation(input.id, input.title),
    onSuccess: (_d, input) => {
      const clean = input.title.replace(/\s+/g, " ").trim();
      queryClient.setQueryData<ConversationRow[]>(conversationsQuery().queryKey, (old) =>
        (old ?? []).map((c) => (c.id === input.id ? { ...c, title: clean } : c)),
      );
      queryClient.setQueryData<ConversationRow | null>(["conversation", input.id], (old) =>
        old ? { ...old, title: clean } : old,
      );
      onOpenChange(false);
    },
    onError: (e) => toast.error("Не удалось переименовать", { description: e.message }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!conversation || !title.trim()) return;
    mutation.mutate({ id: conversation.id, title });
  };

  return (
    <Dialog open={!!conversation} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Переименовать диалог</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <Input
            autoFocus
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Название диалога"
            className="h-10"
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={!title.trim() || mutation.isPending}>
              {mutation.isPending && <Loader2 className="animate-spin" />}
              Сохранить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteConversationDialog({
  conversation,
  onOpenChange,
}: {
  conversation: Pick<ConversationRow, "id" | "title"> | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { conversationId?: string };
  const { abandon } = useChatRuntime();

  const mutation = useMutation({
    mutationFn: async (id: string) => {
      abandon(id);
      await deleteConversation(id);
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData<ConversationRow[]>(conversationsQuery().queryKey, (old) =>
        (old ?? []).filter((c) => c.id !== id),
      );
      queryClient.removeQueries({ queryKey: ["messages", id] });
      queryClient.removeQueries({ queryKey: ["conversation", id] });
      onOpenChange(false);
      if (params.conversationId === id) void navigate({ to: "/chat", replace: true });
      toast.success("Диалог удалён");
    },
    onError: (e) => toast.error("Не удалось удалить", { description: e.message }),
  });

  return (
    <AlertDialog open={!!conversation} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить диалог?</AlertDialogTitle>
          <AlertDialogDescription>
            «{conversation?.title}» будет удалён вместе со всеми сообщениями и изображениями. Это
            действие нельзя отменить.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={mutation.isPending}
            onClick={(e) => {
              e.preventDefault();
              if (conversation) mutation.mutate(conversation.id);
            }}
          >
            {mutation.isPending && <Loader2 className="animate-spin" />}
            Удалить
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
