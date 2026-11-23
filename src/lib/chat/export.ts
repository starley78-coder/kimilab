import { z } from "zod";

import { splitMessageContent } from "@/lib/chat/text-files";
import { parseStoredAttachments } from "@/lib/chat/schema";

export interface ExportConversation {
  id: string;
  title: string;
  system_prompt: string | null;
  is_pinned: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExportMessage {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  attachments: unknown;
  status: string;
  model: string | null;
  reasoning_effort: string | null;
  finish_reason: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
  created_at: string;
}

export const BACKUP_FORMAT = "kimi-lab-backup";
export const BACKUP_VERSION = 1;

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("ru-RU");
}

/** A readable Markdown transcript of one conversation. */
export function conversationToMarkdown(c: ExportConversation, messages: ExportMessage[]): string {
  const lines: string[] = [
    `# ${c.title}`,
    "",
    `_Экспорт из Kimi Lab · создан ${fmtDate(c.created_at)}_`,
    "",
  ];
  if (c.system_prompt?.trim()) {
    lines.push(
      "> **Системная инструкция**",
      ...c.system_prompt
        .trim()
        .split("\n")
        .map((l) => `> ${l}`),
      "",
    );
  }
  for (const m of messages) {
    if (m.role === "assistant" && m.status === "stopped" && !m.content.trim()) continue;
    lines.push("---", "");
    if (m.role === "user") {
      lines.push(`### Вы · ${fmtDate(m.created_at)}`, "");
      const { text, files } = splitMessageContent(m.content);
      for (const a of parseStoredAttachments(m.attachments)) lines.push(`🖼 Изображение: ${a.name}`);
      for (const f of files) lines.push(`📄 Файл: ${f.name}`, "", "````", f.content, "````", "");
      if (text) lines.push(text);
    } else {
      const meta = [m.model, m.reasoning_effort && `рассуждения: ${m.reasoning_effort}`]
        .filter(Boolean)
        .join(" · ");
      lines.push(`### Kimi${meta ? ` · ${meta}` : ""}`, "", m.content);
      const usage = [
        m.prompt_tokens !== null && `вход ${m.prompt_tokens}`,
        m.completion_tokens !== null && `выход ${m.completion_tokens}`,
      ].filter(Boolean);
      if (usage.length) lines.push("", `_Токены (usage API): ${usage.join(", ")}_`);
      if (m.status === "stopped") lines.push("", "_Генерация остановлена_");
    }
    lines.push("");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function conversationToJson(c: ExportConversation, messages: ExportMessage[]) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    conversations: [{ ...c, messages }],
  };
}

export function buildBackup(conversations: ExportConversation[], messages: ExportMessage[]) {
  const byConv = new Map<string, ExportMessage[]>();
  for (const m of messages) {
    const list = byConv.get(m.conversation_id) ?? [];
    list.push(m);
    byConv.set(m.conversation_id, list);
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    conversations: conversations.map((c) => ({ ...c, messages: byConv.get(c.id) ?? [] })),
  };
}

const nullableInt = z.number().int().nonnegative().nullable().optional();
const backupMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(400_000),
  attachments: z.unknown().optional(),
  status: z.enum(["complete", "stopped"]).optional(),
  model: z.string().max(200).nullable().optional(),
  reasoning_effort: z.enum(["low", "high", "max"]).nullable().optional(),
  finish_reason: z.string().max(100).nullable().optional(),
  prompt_tokens: nullableInt,
  completion_tokens: nullableInt,
  reasoning_tokens: nullableInt,
  total_tokens: nullableInt,
  created_at: z.string().optional(),
});
const backupConversationSchema = z.object({
  title: z.string().min(1).max(200),
  system_prompt: z.string().max(20_000).nullable().optional(),
  is_pinned: z.boolean().optional(),
  is_archived: z.boolean().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  messages: z.array(backupMessageSchema).max(5000),
});
export const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  conversations: z.array(backupConversationSchema).max(5000),
});
export type Backup = z.infer<typeof backupSchema>;
export type BackupMessage = z.infer<typeof backupMessageSchema>;

export function parseBackup(
  raw: string,
): { ok: true; backup: Backup } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Файл не является JSON." };
  }
  const parsed = backupSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: `Неверный формат резервной копии${issue ? `: ${issue.path.join(".")} — ${issue.message}` : ""}.`,
    };
  }
  return { ok: true, backup: parsed.data };
}

/** Images are not part of the backup: imported messages keep a note instead of the file. */
export function importedContent(m: BackupMessage): string {
  const images = parseStoredAttachments(m.attachments);
  if (!images.length) return m.content;
  const note = images.map((a) => `[изображение не восстановлено: ${a.name}]`).join("\n");
  return [m.content, note].filter((s) => s.trim()).join("\n\n");
}

export function safeFileName(title: string): string {
  return (
    title
      .replace(/[\\/:*?"<>|\n\r]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "dialog"
  );
}

export function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
