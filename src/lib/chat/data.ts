import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { getKimiStatus } from "@/lib/kimi.functions";
import { IMAGE_BUCKET, parseStoredAttachments, type StoredAttachment } from "@/lib/chat/schema";
import type { ReasoningEffort } from "@/lib/kimi/config";
import {
  importedContent,
  type Backup,
  type ExportConversation,
  type ExportMessage,
} from "@/lib/chat/export";

export type ConversationRow = Pick<
  Tables<"conversations">,
  "id" | "title" | "created_at" | "updated_at" | "system_prompt" | "is_pinned" | "is_archived"
>;

const CONVERSATION_COLUMNS =
  "id, title, created_at, updated_at, system_prompt, is_pinned, is_archived";
export type MessageRow = Tables<"messages">;

export const conversationsQuery = () =>
  queryOptions({
    queryKey: ["conversations"],
    queryFn: async (): Promise<ConversationRow[]> => {
      const { data, error } = await supabase
        .from("conversations")
        .select(CONVERSATION_COLUMNS)
        .order("is_pinned", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(1000);
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
        .select(CONVERSATION_COLUMNS)
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
    .select(CONVERSATION_COLUMNS)
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

export async function updateConversation(
  id: string,
  patch: { is_pinned?: boolean; is_archived?: boolean; system_prompt?: string | null },
): Promise<void> {
  const { error } = await supabase.from("conversations").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export interface UserSettings {
  default_system_prompt: string;
}

export const userSettingsQuery = () =>
  queryOptions({
    queryKey: ["user-settings"],
    queryFn: async (): Promise<UserSettings> => {
      const { data, error } = await supabase
        .from("user_settings")
        .select("default_system_prompt")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return { default_system_prompt: data?.default_system_prompt ?? "" };
    },
  });

export async function saveDefaultSystemPrompt(userId: string, prompt: string): Promise<void> {
  const { error } = await supabase.from("user_settings").upsert(
    {
      user_id: userId,
      default_system_prompt: prompt.trim(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);
}

/**
 * Deletes every message after `seq` in the conversation (optionally including it)
 * and removes their stored images, except paths listed in `keepPaths`.
 */
export async function deleteMessagesFrom(
  conversationId: string,
  seq: number,
  inclusive: boolean,
  keepPaths: string[] = [],
): Promise<void> {
  const base = supabase
    .from("messages")
    .select("attachments")
    .eq("conversation_id", conversationId);
  const { data: rows, error: readError } = await (inclusive
    ? base.gte("seq", seq)
    : base.gt("seq", seq));
  if (readError) throw new Error(readError.message);
  const keep = new Set(keepPaths);
  const paths = (rows ?? [])
    .flatMap((r) => parseStoredAttachments(r.attachments).map((a) => a.path))
    .filter((p) => !keep.has(p));
  const del = supabase.from("messages").delete().eq("conversation_id", conversationId);
  const { error } = await (inclusive ? del.gte("seq", seq) : del.gt("seq", seq));
  if (error) throw new Error(error.message);
  if (paths.length) {
    const { error: storageError } = await supabase.storage.from(IMAGE_BUCKET).remove(paths);
    if (storageError) console.warn("[chat] image cleanup failed", storageError.message);
  }
}

export async function updateMessageContent(id: string, content: string): Promise<void> {
  const { error } = await supabase.from("messages").update({ content }).eq("id", id);
  if (error) throw new Error(error.message);
}

const EXPORT_MESSAGE_COLUMNS =
  "id, conversation_id, role, content, attachments, status, model, reasoning_effort, finish_reason, prompt_tokens, completion_tokens, reasoning_tokens, total_tokens, created_at";

async function fetchAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < size) return out;
  }
}

export async function loadEverything(): Promise<{
  conversations: ExportConversation[];
  messages: ExportMessage[];
}> {
  const conversations = await fetchAll<ExportConversation>((from, to) =>
    supabase.from("conversations").select(CONVERSATION_COLUMNS).order("created_at").range(from, to),
  );
  const messages = await fetchAll<ExportMessage>((from, to) =>
    supabase.from("messages").select(EXPORT_MESSAGE_COLUMNS).order("seq").range(from, to),
  );
  return { conversations, messages };
}

export async function loadConversationExport(id: string): Promise<{
  conversation: ExportConversation;
  messages: ExportMessage[];
}> {
  const { data: conversation, error } = await supabase
    .from("conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  const messages = await fetchAll<ExportMessage>((from, to) =>
    supabase
      .from("messages")
      .select(EXPORT_MESSAGE_COLUMNS)
      .eq("conversation_id", id)
      .order("seq")
      .range(from, to),
  );
  return { conversation, messages };
}

/** Restores a backup as new conversations (new IDs, so nothing existing is overwritten). */
export async function importBackup(
  backup: Backup,
  onProgress?: (done: number, total: number) => void,
): Promise<{ conversations: number; messages: number }> {
  let messageCount = 0;
  const total = backup.conversations.length;
  for (const [i, c] of backup.conversations.entries()) {
    const id = crypto.randomUUID();
    const { error } = await supabase.from("conversations").insert({
      id,
      title: c.title,
      system_prompt: c.system_prompt ?? null,
      is_pinned: c.is_pinned ?? false,
      is_archived: c.is_archived ?? false,
      ...(c.created_at ? { created_at: c.created_at } : {}),
    });
    if (error) throw new Error(`«${c.title}»: ${error.message}`);
    for (let from = 0; from < c.messages.length; from += 200) {
      const batch = c.messages.slice(from, from + 200).map((m) => ({
        conversation_id: id,
        role: m.role,
        content: importedContent(m),
        attachments: [],
        status: m.status ?? "complete",
        model: m.model ?? null,
        reasoning_effort: m.reasoning_effort ?? null,
        finish_reason: m.finish_reason ?? null,
        prompt_tokens: m.prompt_tokens ?? null,
        completion_tokens: m.completion_tokens ?? null,
        reasoning_tokens: m.reasoning_tokens ?? null,
        total_tokens: m.total_tokens ?? null,
        ...(m.created_at ? { created_at: m.created_at } : {}),
      }));
      const { error: msgError } = await supabase.from("messages").insert(batch);
      if (msgError) throw new Error(`«${c.title}»: ${msgError.message}`);
      messageCount += batch.length;
    }
    if (c.updated_at) {
      await supabase.from("conversations").update({ updated_at: c.updated_at }).eq("id", id);
    }
    onProgress?.(i + 1, total);
  }
  return { conversations: total, messages: messageCount };
}
