/**
 * Pure helpers for "Резюме и шаги": builds a bounded transcript for the model and
 * normalizes the structured result. Shared by server and tests.
 */
import { z } from "zod";

export const SUMMARY_MODEL = "openai/gpt-6-astra";
export const MAX_TRANSCRIPT_CHARS = 120_000;
export const MAX_ACTION_ITEMS = 12;

export interface TranscriptMessage {
  role: string;
  content: string;
}

/** Replaces inlined text-file blocks with a short marker so files don't eat the budget. */
export function compactFiles(content: string): string {
  return content.replace(
    /<file name="([^"]*)"[^>]*>[\s\S]*?<\/file>/g,
    (_m, name: string) => `[прикреплён файл: ${name}]`,
  );
}

/**
 * Newest messages win: walks backwards until the character budget is used, then
 * returns them in chronological order. `truncated` reports that older ones were left out.
 */
export function buildTranscript(messages: TranscriptMessage[], maxChars = MAX_TRANSCRIPT_CHARS) {
  const picked: string[] = [];
  let used = 0;
  let truncated = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    const text = compactFiles(m.content).trim();
    if (!text) continue;
    const line = `${m.role === "user" ? "Пользователь" : "Ассистент"}: ${text}`;
    if (used + line.length > maxChars) {
      if (picked.length === 0) {
        picked.push(line.slice(line.length - maxChars));
        used = maxChars;
      }
      truncated = true;
      break;
    }
    picked.push(line);
    used += line.length + 2;
  }
  picked.reverse();
  return { text: picked.join("\n\n"), count: picked.length, truncated };
}

export const summaryOutputSchema = z.object({
  summary: z.string(),
  action_items: z.array(z.string()),
});
export type SummaryOutput = z.infer<typeof summaryOutputSchema>;

export function normalizeSummary(out: SummaryOutput): SummaryOutput {
  return {
    summary: out.summary.trim().slice(0, 20_000),
    action_items: out.action_items
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_ACTION_ITEMS),
  };
}

export const SUMMARY_INSTRUCTIONS = `Ты готовишь краткое резюме диалога пользователя с ассистентом Kimi.
Пиши по-русски.
summary — 3–8 предложений: о чём шла речь, к каким выводам и решениям пришли, что осталось открытым.
action_items — от 0 до 8 конкретных дальнейших действий для пользователя, каждое — одна короткая фраза, начинающаяся с глагола. Не выдумывай действий, которых нет в диалоге; если их нет, верни пустой список.
Не цитируй код целиком и не добавляй ничего, чего не было в диалоге.`;
