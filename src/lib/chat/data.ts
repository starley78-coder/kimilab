import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { getKimiStatus } from "@/lib/kimi.functions";
import { IMAGE_BUCKET, parseStoredAttachments, type StoredAttachment } from "@/lib/chat/schema";
import type { ReasoningEffort } from "@/lib/kimi/config";

export type ConversationRow = Pick<
  Tables<"conversations">,
  "id" | "title" | "created_at" | "updated_at"
>;
export type MessageRow = Tables<"messages">;

export const conversationsQuery = () =>
  queryOptions({
    queryKey: ["conversations"],
    queryFn: async (): Promise<ConversationRow[]> => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, title, created_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return data;
    },
  });

export const conversationQuery = (id: string) =>
  queryOptions({
    queryKey: ["conversation", id],
    queryFn: async (): Promise<ConversationRow | null> => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, title, created_at, updated_at")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });

export const messagesQuery = (conversationId: string) =>
  queryOptions({
    queryKey: ["messages", conversationId],
    queryFn: async (): Promise<MessageRow[]> => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("seq", { ascending: true })
        .limit(2000);
      if (error) throw new Error(error.message);
      return data;
    },
  });

export interface WorkspaceAccess {
  has_access: boolean;
  role?: string;
  claimed?: boolean;
}

export const accessQuery = () =>
  queryOptions({
    queryKey: ["workspace-access"],
    staleTime: Infinity,
    queryFn: async (): Promise<WorkspaceAccess> => {
      const { data, error } = await supabase.rpc("claim_workspace_access");
      if (error) throw new Error(error.message);
      return (data as unknown as WorkspaceAccess) ?? { has_access: false };
    },
  });

export const kimiStatusQuery = () =>
  queryOptions({
    queryKey: ["kimi-status"],
    staleTime: 60_000,
    queryFn: () => getKimiStatus(),
  });

export async function createConversation(id: string, title: string): Promise<ConversationRow> {
  const { data, error } = await supabase
    .from("conversations")
    .insert({ id, title })
    .select("id, title, created_at, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!clean) throw new Error("Название не может быть пустым");
  const { error } = await supabase.from("conversations").update({ title: clean }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteConversation(id: string): Promise<void> {
  const { data: rows, error: readError } = await supabase
    .from("messages")
    .select("attachments")
    .eq("conversation_id", id);
  if (readError) throw new Error(readError.message);
  const paths = (rows ?? []).flatMap((r) =>
    parseStoredAttachments(r.attachments).map((a) => a.path),
  );
  if (paths.length) {
    // Best effort: remove the stored images first; the conversation delete cascades messages.
    const { error: storageError } = await supabase.storage.from(IMAGE_BUCKET).remove(paths);
    if (storageError) console.warn("[chat] image cleanup failed", storageError.message);
  }
  const { error } = await supabase.from("conversations").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function uploadImage(path: string, blob: Blob, contentType: string): Promise<void> {
  const { error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, blob, { contentType, upsert: false, cacheControl: "3600" });
  if (error) throw new Error(error.message);
}

export async function saveStoppedReply(input: {
  id: string;
  conversationId: string;
  userId: string;
  content: string;
  model: string | null;
  reasoningEffort: ReasoningEffort;
}): Promise<void> {
  const { error } = await supabase.from("messages").upsert(
    {
      id: input.id,
      conversation_id: input.conversationId,
      user_id: input.userId,
      role: "assistant",
      content: input.content,
      status: "stopped",
      model: input.model,
      reasoning_effort: input.reasoningEffort,
      finish_reason: "stopped",
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
}

/** Removes "stopped before any text" markers so a resend replaces them. */
export async function deleteEmptyStoppedReplies(conversationId: string): Promise<void> {
  const { error } = await supabase
    .from("messages")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("role", "assistant")
    .eq("status", "stopped")
    .eq("content", "");
  if (error) throw new Error(error.message);
}

/** A reply the user stopped before the model produced any visible text. */
export function isEmptyStoppedReply(row: Pick<MessageRow, "role" | "status" | "content">): boolean {
  return row.role === "assistant" && row.status === "stopped" && !row.content.trim();
}

export const signedUrlsQuery = (paths: string[]) =>
  queryOptions({
    queryKey: ["signed-urls", ...paths],
    staleTime: 50 * 60 * 1000,
    enabled: paths.length > 0,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase.storage
        .from(IMAGE_BUCKET)
        .createSignedUrls(paths, 3600);
      if (error) throw new Error(error.message);
      const out: Record<string, string> = {};
      for (const item of data ?? []) {
        if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
      }
      return out;
    },
  });

export interface SearchHit {
  conversationId: string;
  title: string;
  snippet: string | null;
  updatedAt: string;
}

function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function makeSnippet(content: string, q: string): string {
  const lower = content.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  const flat = content.replace(/\s+/g, " ");
  if (idx < 0) return flat.slice(0, 90);
  const start = Math.max(0, idx - 30);
  const raw = content
    .slice(start, idx + q.length + 60)
    .replace(/\s+/g, " ")
    .trim();
  return `${start > 0 ? "…" : ""}${raw}${idx + q.length + 60 < content.length ? "…" : ""}`;
}

export async function searchHistory(query: string): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const pattern = `%${escapeLike(q)}%`;
  const [titles, messages] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, title, updated_at")
      .ilike("title", pattern)
      .order("updated_at", { ascending: false })
      .limit(30),
    supabase
      .from("messages")
      .select("conversation_id, content, created_at, conversations(title, updated_at)")
      .ilike("content", pattern)
      .order("created_at", { ascending: false })
      .limit(60),
  ]);
  if (titles.error) throw new Error(titles.error.message);
  if (messages.error) throw new Error(messages.error.message);

  const hits = new Map<string, SearchHit>();
  for (const row of messages.data ?? []) {
    if (hits.has(row.conversation_id)) continue;
    const conv = row.conversations as { title: string; updated_at: string } | null;
    hits.set(row.conversation_id, {
      conversationId: row.conversation_id,
      title: conv?.title ?? "Диалог",
      snippet: makeSnippet(row.content, q),
      updatedAt: conv?.updated_at ?? row.created_at,
    });
  }
  for (const row of titles.data ?? []) {
    if (!hits.has(row.id)) {
      hits.set(row.id, {
        conversationId: row.id,
        title: row.title,
        snippet: null,
        updatedAt: row.updated_at,
      });
    }
  }
  return [...hits.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function attachmentsOf(row: Pick<MessageRow, "attachments">): StoredAttachment[] {
  return parseStoredAttachments(row.attachments);
}
