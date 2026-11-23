import { z } from "zod";

import { REASONING_EFFORTS } from "@/lib/kimi/config";

export const IMAGE_BUCKET = "chat-images";
export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];
export const MAX_IMAGES_PER_MESSAGE = 4;
/** Max size of an original file the user can pick (before client-side downscaling). */
export const MAX_IMAGE_INPUT_BYTES = 20 * 1024 * 1024;
/** Max stored size after downscaling (bucket limit is 10 MB). */
export const MAX_IMAGE_STORED_BYTES = 8 * 1024 * 1024;
export const MAX_MESSAGE_CHARS = 300_000;

export const storedAttachmentSchema = z.object({
  path: z
    .string()
    .min(3)
    .max(300)
    .regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp)$/),
  name: z.string().min(1).max(200),
  mediaType: z.enum(ALLOWED_IMAGE_TYPES),
  size: z.number().int().positive().max(MAX_IMAGE_STORED_BYTES),
  width: z.number().int().positive().max(20000).optional(),
  height: z.number().int().positive().max(20000).optional(),
});

export type StoredAttachment = z.infer<typeof storedAttachmentSchema>;

export const chatRequestSchema = z
  .object({
    conversationId: z.string().uuid(),
    userMessageId: z.string().uuid(),
    assistantMessageId: z.string().uuid(),
    content: z.string().max(MAX_MESSAGE_CHARS),
    attachments: z.array(storedAttachmentSchema).max(MAX_IMAGES_PER_MESSAGE).default([]),
    reasoningEffort: z.enum(REASONING_EFFORTS),
  })
  .refine((v) => v.content.trim().length > 0 || v.attachments.length > 0, {
    message: "Сообщение пустое",
    path: ["content"],
  });

export type ChatRequestBody = z.infer<typeof chatRequestSchema>;

export function parseStoredAttachments(value: unknown): StoredAttachment[] {
  if (!Array.isArray(value)) return [];
  const out: StoredAttachment[] = [];
  for (const item of value) {
    const parsed = storedAttachmentSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function extensionForType(type: AllowedImageType): "png" | "jpg" | "webp" {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

/** Title for a new conversation derived from the first message. */
export function deriveTitle(text: string, hasImages: boolean): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return hasImages ? "Анализ изображения" : "Новый диалог";
  const file = /^<file name="([^"\n]*)">/.exec(clean);
  if (file) {
    const rest = clean.replace(/<file name="[^"\n]*">[\s\S]*?<\/file>/g, "").trim();
    return deriveTitle(rest || `Файл: ${file[1]}`, hasImages);
  }
  return clean.length > 60 ? `${clean.slice(0, 57).trimEnd()}…` : clean;
}
