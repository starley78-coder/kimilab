import { isToday, isYesterday, differenceInCalendarDays } from "date-fns";

const tokenFormatter = new Intl.NumberFormat("ru-RU");

export function formatTokens(value: number | null | undefined): string {
  return typeof value === "number" ? tokenFormatter.format(value) : "—";
}

export function formatSeconds(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  return `${m} мин ${s % 60} с`;
}

export type DateGroup = "Сегодня" | "Вчера" | "Последние 7 дней" | "Последние 30 дней" | "Ранее";

export function dateGroupOf(iso: string, now = new Date()): DateGroup {
  const d = new Date(iso);
  if (isToday(d)) return "Сегодня";
  if (isYesterday(d)) return "Вчера";
  const diff = differenceInCalendarDays(now, d);
  if (diff <= 7) return "Последние 7 дней";
  if (diff <= 30) return "Последние 30 дней";
  return "Ранее";
}

export function groupByDate<T extends { updated_at: string }>(
  items: T[],
): { group: DateGroup; items: T[] }[] {
  const order: DateGroup[] = ["Сегодня", "Вчера", "Последние 7 дней", "Последние 30 дней", "Ранее"];
  const map = new Map<DateGroup, T[]>();
  const now = new Date();
  for (const item of items) {
    const g = dateGroupOf(item.updated_at, now);
    const list = map.get(g) ?? [];
    list.push(item);
    map.set(g, list);
  }
  return order.filter((g) => map.has(g)).map((g) => ({ group: g, items: map.get(g)! }));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
