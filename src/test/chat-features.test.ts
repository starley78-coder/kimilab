import { describe, expect, it } from "vitest";

import { autoRetryDelay } from "@/components/chat/error-card";
import { lastContextTokens } from "@/components/chat/thread-tools";
import { extractCodeBlocks, fileNameForBlock } from "@/lib/chat/code-blocks";
import { importedContent, parseBackup } from "@/lib/chat/export";
import { deriveTitle } from "@/lib/chat/schema";
import { buildMessageContent, isTextFileName, splitMessageContent } from "@/lib/chat/text-files";
import { parseContextWindow } from "@/lib/kimi/config";
import { resolveSystemPrompt, withSystemPrompt } from "@/lib/kimi/request";

describe("text files", () => {
  it("round-trips files and typed text", () => {
    const content = buildMessageContent("Объясни код", [
      { name: "main.py", content: "print(1)\n" },
    ]);
    expect(content).toBe('<file name="main.py">\nprint(1)\n</file>\n\nОбъясни код');
    expect(splitMessageContent(content)).toEqual({
      text: "Объясни код",
      files: [{ name: "main.py", content: "print(1)" }],
    });
  });
  it("accepts code extensions and rejects binaries", () => {
    expect(isTextFileName("App.TSX")).toBe(true);
    expect(isTextFileName("photo.pdf")).toBe(false);
  });
  it("titles a file-only message after the file", () => {
    expect(deriveTitle(buildMessageContent("", [{ name: "a.ts", content: "x" }]), false)).toBe(
      "Файл: a.ts",
    );
  });
});

describe("code blocks", () => {
  it("extracts fenced blocks with a matching download name", () => {
    const blocks = extractCodeBlocks("Текст\n```python\nprint(1)\n```\nи\n```\nraw\n```");
    expect(blocks).toEqual([
      { language: "python", code: "print(1)" },
      { language: "", code: "raw" },
    ]);
    expect(fileNameForBlock(blocks[0]!, 0)).toBe("snippet-1.py");
    expect(fileNameForBlock(blocks[1]!, 1)).toBe("snippet-2.txt");
  });
});

describe("system instructions", () => {
  it("conversation instruction wins, empty means none, null falls back to default", () => {
    expect(resolveSystemPrompt("Своя", "Общая")).toBe("Своя");
    expect(resolveSystemPrompt("", "Общая")).toBe("");
    expect(resolveSystemPrompt(null, " Общая ")).toBe("Общая");
  });
  it("is sent first as role system, and omitted when empty", () => {
    const msgs = [{ role: "user" as const, content: "привет" }];
    expect(withSystemPrompt(msgs, "Будь краток")[0]).toEqual({
      role: "system",
      content: "Будь краток",
    });
    expect(withSystemPrompt(msgs, "  ")).toEqual(msgs);
  });
});

describe("rate-limit auto retry", () => {
  it("counts down only for rate limits within 120 s", () => {
    expect(autoRetryDelay({ code: "provider_rate_limited", retryAfter: 5 })).toBe(5);
    expect(autoRetryDelay({ code: "app_rate_limited", retryAfter: 0.2 })).toBe(1);
    expect(autoRetryDelay({ code: "app_rate_limited", retryAfter: 3600 })).toBeNull();
    expect(autoRetryDelay({ code: "invalid_api_key", retryAfter: 5 })).toBeNull();
    expect(autoRetryDelay({ code: "provider_rate_limited" })).toBeNull();
  });
});

describe("context meter", () => {
  const row = (p: number | null, c: number | null, status = "complete") => ({
    role: "assistant",
    status,
    content: "ok",
    prompt_tokens: p,
    completion_tokens: c,
  });
  it("uses the latest reply with API usage only", () => {
    expect(lastContextTokens([row(100, 20), row(null, null, "stopped")])).toBe(120);
    expect(lastContextTokens([row(null, null)])).toBeNull();
  });
  it("shows a window only when KIMI_CONTEXT_WINDOW is set", () => {
    expect(parseContextWindow(undefined)).toBeNull();
    expect(parseContextWindow("262144")).toBe(262144);
  });
});

describe("backup", () => {
  it("rejects foreign files and keeps a note for images", () => {
    expect(parseBackup('{"a":1}').ok).toBe(false);
    expect(parseBackup("not json").ok).toBe(false);
    const ok = parseBackup(
      JSON.stringify({
        format: "kimi-lab-backup",
        version: 1,
        conversations: [{ title: "T", messages: [{ role: "user", content: "hi" }] }],
      }),
    );
    expect(ok.ok).toBe(true);
    const id = "00000000-0000-0000-0000-000000000000";
    expect(
      importedContent({
        role: "user",
        content: "см.",
        attachments: [
          { path: `${id}/${id}/${id}.png`, name: "a.png", mediaType: "image/png", size: 10 },
        ],
      }),
    ).toBe("см.\n\n[изображение не восстановлено: a.png]");
  });
});
