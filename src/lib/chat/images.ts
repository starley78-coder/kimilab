import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_INPUT_BYTES,
  MAX_IMAGE_STORED_BYTES,
  type AllowedImageType,
} from "@/lib/chat/schema";

const MAX_DIMENSION = 2048;
const REENCODE_ABOVE_BYTES = 3.5 * 1024 * 1024;

export interface PreparedImage {
  blob: Blob;
  mediaType: AllowedImageType;
  width: number;
  height: number;
  name: string;
}

export function isAllowedImageType(type: string): type is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type);
}

export async function dataUrlToBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  return res.blob();
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Validates and downsizes an image in the browser so the stored copy stays small.
 * Large photos are scaled to fit 2048px and re-encoded (WebP, JPEG fallback).
 */
export async function prepareImage(input: Blob, name: string): Promise<PreparedImage> {
  const type = input.type;
  if (!isAllowedImageType(type)) {
    throw new Error(`Формат «${type || "неизвестен"}» не поддерживается. Используйте PNG, JPG или WebP.`);
  }
  if (input.size > MAX_IMAGE_INPUT_BYTES) {
    throw new Error("Изображение больше 20 МБ.");
  }

  const bitmap = await createImageBitmap(input);
  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  const needsResize = scale < 1 || input.size > REENCODE_ABOVE_BYTES;

  if (!needsResize) {
    bitmap.close();
    return { blob: input, mediaType: type, width, height, name };
  }

  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Не удалось обработать изображение.");
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  let blob = await canvasToBlob(canvas, "image/webp", 0.9);
  let mediaType: AllowedImageType = "image/webp";
  if (!blob || blob.type !== "image/webp") {
    blob = await canvasToBlob(canvas, "image/jpeg", 0.9);
    mediaType = "image/jpeg";
  }
  if (!blob) throw new Error("Не удалось сжать изображение.");
  if (blob.size > MAX_IMAGE_STORED_BYTES) throw new Error("Изображение слишком большое даже после сжатия.");
  return { blob, mediaType, width: w, height: h, name };
}
