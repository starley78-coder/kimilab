/**
 * Agent tool contracts. The registry is generic so later tools (e.g. agent_task)
 * plug in without changing the chat; only web_search and open_url exist today.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema of the arguments, sent to the model as a function tool. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string of arguments exactly as the model produced it. */
  arguments: string;
}

export type EvidenceType = "search_result" | "opened_page";

export interface SourceReference {
  url: string;
  title: string;
  hostname: string;
  evidence_type: EvidenceType;
  snippet?: string;
}

export interface ToolResult {
  ok: boolean;
  /** Structured payload returned to the model (untrusted content lives in here). */
  data: Record<string, unknown>;
  /** Sources this result actually produced — never URLs invented by the model. */
  sources: SourceReference[];
  error?: string;
}

export type ToolRunState = "running" | "success" | "error" | "blocked" | "skipped";

export interface ToolRunStatus {
  id: string;
  tool: string;
  state: ToolRunState;
  /** Short, secret-free label: the query or the URL host/path. */
  label: string;
  error?: string;
  duration_ms?: number;
}

export interface ToolContext {
  signal: AbortSignal;
}

export type ToolExecutor = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

export interface RegisteredTool {
  definition: ToolDefinition;
  execute: ToolExecutor;
  /** Name of the per-answer budget this tool draws from. */
  budget: "search" | "open";
}
