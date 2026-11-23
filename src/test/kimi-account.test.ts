import { describe, expect, it } from "vitest";

import {
  DOCUMENTED_CONTEXT_WINDOW,
  balanceLevel,
  contextUsage,
  isQuotaErrorBody,
  parseBalance,
  parseEstimate,
  supportsAccountApi,
} from "@/lib/kimi/balance";
import { balanceExhaustedError } from "@/lib/kimi/errors";
import {
  MAX_ACTION_ITEMS,
  buildTranscript,
  compactFiles,
  normalizeSummary,
} from "@/lib/summary/prepare";

describe("Kimi balance", () => {
  it("parses the documented balance response", () => {
    expect(
      parseBalance({
        code: 0,
        data: { available_balance: 49.58894, voucher_balance: 46.58893, cash_balance: 3.00001 },
        scode: "0x0",
        status: true,
      }),
    ).toEqual({ available: 49.58894, voucher: 46.58893, cash: 3.00001 });
  });

  it("rejects an unexpected shape instead of inventing a number", () => {
    expect(parseBalance({ data: { available_balance: "5" } })).toBeNull();
    expect(parseBalance(null)).toBeNull();
  });

  it("is red at zero or below, yellow under $1, normal from $1", () => {
    expect(balanceLevel(0)).toBe("empty");
    expect(balanceLevel(-2)).toBe("empty");
    expect(balanceLevel(0.99)).toBe("low");
    expect(balanceLevel(1)).toBe("ok");
  });

  it("is only queried on the official Moonshot API", () => {
    expect(supportsAccountApi("moonshot")).toBe(true);
    expect(supportsAccountApi("kineticrouter")).toBe(false);
    expect(supportsAccountApi("custom")).toBe(false);
  });

  it("recognizes the quota error and explains it", () => {
    expect(
      isQuotaErrorBody('{"error":{"type":"exceeded_current_quota_error","message":"x"}}'),
    ).toBe(true);
    expect(isQuotaErrorBody('{"error":{"type":"rate_limit_reached_error"}}')).toBe(false);
    expect(balanceExhaustedError().code).toBe("balance_exhausted");
  });
});

describe("context window", () => {
  it("uses the documented 1M-token window", () => {
    expect(DOCUMENTED_CONTEXT_WINDOW).toBe(1_000_000);
  });

  it("warns from 80% and is critical from 95%", () => {
    expect(contextUsage(799_999, 1_000_000).level).toBe("ok");
    expect(contextUsage(800_000, 1_000_000).level).toBe("warn");
    expect(contextUsage(950_000, 1_000_000).level).toBe("critical");
  });

  it("reports the remaining tokens", () => {
    expect(contextUsage(250_000, 1_000_000).remaining).toBe(750_000);
  });

  it("reads the token estimate", () => {
    expect(parseEstimate({ data: { total_tokens: 80 } })).toBe(80);
    expect(parseEstimate({})).toBeNull();
  });
});

describe("conversation summary", () => {
  it("keeps the newest messages when the budget runs out", () => {
    const msgs = [
      { role: "user", content: "старое ".repeat(50) },
      { role: "assistant", content: "новое" },
    ];
    const t = buildTranscript(msgs, 100);
    expect(t.truncated).toBe(true);
    expect(t.text).toBe("Ассистент: новое");
  });

  it("replaces attached file bodies with their names", () => {
    expect(compactFiles('Смотри\n<file name="a.py">\nprint(1)\n</file>')).toBe(
      "Смотри\n[прикреплён файл: a.py]",
    );
  });

  it("limits the number of next steps", () => {
    const out = normalizeSummary({
      summary: " ok ",
      action_items: Array.from({ length: 20 }, (_, i) => `шаг ${i}`).concat(["  "]),
    });
    expect(out.action_items).toHaveLength(MAX_ACTION_ITEMS);
    expect(out.summary).toBe("ok");
  });
});

import { PROMPT_PRESETS } from "@/lib/chat/presets";

describe("instruction presets", () => {
  it("include the adapted constitution within the 20 000-character limit", () => {
    const c = PROMPT_PRESETS.find((p) => p.id === "constitution");
    expect(c?.text).toContain("[ПРОВЕРЕНО]");
    expect((c?.text.length ?? 0) < 20_000).toBe(true);
  });
});
