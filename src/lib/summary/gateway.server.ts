/**
 * Lovable AI Gateway call for conversation summaries. Server only: the key never
 * leaves this module. Kimi chat requests do not go through here.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { NoObjectGeneratedError, Output, streamText } from "ai";

import {
  SUMMARY_INSTRUCTIONS,
  SUMMARY_MODEL,
  normalizeSummary,
  summaryOutputSchema,
  type SummaryOutput,
} from "./prepare";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1";
const RUN_ID_HEADER = "X-Lovable-AIG-Run-ID";

function runIdFetch() {
  let runId: string | undefined;
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (runId && !headers.has(RUN_ID_HEADER)) headers.set(RUN_ID_HEADER, runId);
    const res = await fetch(input, { ...init, headers });
    runId ??= res.headers.get(RUN_ID_HEADER)?.trim() || undefined;
    return res;
  };
}

export class GatewayError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function statusOf(e: unknown): number | null {
  if (e && typeof e === "object") {
    const s = (e as { statusCode?: unknown }).statusCode;
    if (typeof s === "number") return s;
    const cause = (e as { cause?: unknown }).cause;
    if (cause) return statusOf(cause);
  }
  return null;
}

export async function summarizeTranscript(
  apiKey: string,
  transcript: string,
  signal?: AbortSignal,
): Promise<SummaryOutput> {
  const provider = createOpenAI({
    baseURL: GATEWAY_URL,
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: runIdFetch(),
  });
  let streamError: unknown = null;
  const result = streamText({
    model: provider.responses(SUMMARY_MODEL),
    instructions: SUMMARY_INSTRUCTIONS,
    messages: [{ role: "user", content: `Диалог:\n\n${transcript}` }],
    output: Output.object({ schema: summaryOutputSchema }),
    maxRetries: 0,
    ...(signal ? { abortSignal: signal } : {}),
    onError: ({ error }) => {
      streamError = error;
    },
    providerOptions: {
      openai: {
        forceReasoning: true,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        store: false,
        include: ["reasoning.encrypted_content"],
      },
    },
  });
  try {
    const output = await result.output;
    return normalizeSummary(output);
  } catch (e) {
    const status = statusOf(streamError) ?? statusOf(e);
    if (status) throw new GatewayError(status, "gateway");
    if (NoObjectGeneratedError.isInstance(e)) throw new GatewayError(422, "no_object");
    throw e;
  }
}
