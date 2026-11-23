import { ExternalLink, FileCheck2, Search } from "lucide-react";

import type { SourceReference, ToolRunStatus } from "@/lib/tools/types";

/** Keeps only well-formed http(s) sources; anything else is never rendered as a link. */
export function parseSources(value: unknown): SourceReference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    if (!v || typeof v !== "object") return [];
    const s = v as Record<string, unknown>;
    const url = typeof s["url"] === "string" ? s["url"] : "";
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return [];
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return [];
    return [
      {
        url: parsed.toString(),
        title: typeof s["title"] === "string" && s["title"] ? s["title"] : parsed.hostname,
        hostname: parsed.hostname.replace(/^www\./, ""),
        evidence_type: s["evidence_type"] === "opened_page" ? "opened_page" : "search_result",
      } satisfies SourceReference,
    ];
  });
}

export function parseToolRuns(value: unknown): ToolRunStatus[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is ToolRunStatus =>
      !!v && typeof v === "object" && typeof (v as ToolRunStatus).tool === "string",
  );
}

/** Status line for a running search turn, based only on events the server actually sent. */
export function searchStatusLabel(runs: ToolRunStatus[], analyzing: boolean): string | null {
  const running = runs.find((r) => r.state === "running");
  if (running) return running.tool === "open_url" ? "Открываю источник…" : "Ищу…";
  if (analyzing && runs.some((r) => r.state === "success")) return "Анализирую источники…";
  return null;
}

export function SourcesBlock({
  sources,
  runs,
}: {
  sources: SourceReference[];
  runs: ToolRunStatus[];
}) {
  const failed = runs.filter((r) => r.state === "error" || r.state === "blocked");
  if (sources.length === 0 && failed.length === 0) return null;
  const opened = sources.filter((s) => s.evidence_type === "opened_page");
  const found = sources.filter((s) => s.evidence_type === "search_result");
  return (
    <div className="mt-1 min-w-0 rounded-xl border bg-card/60 p-3 text-sm">
      {sources.length > 0 && (
        <p className="mb-2 text-xs font-medium text-muted-foreground">Источники</p>
      )}
      <ul className="flex flex-col gap-2">
        {[...opened, ...found].map((s) => (
          <li key={s.url} className="flex min-w-0 items-start gap-2">
            {s.evidence_type === "opened_page" ? (
              <FileCheck2 className="mt-0.5 size-3.5 shrink-0 text-signal" aria-hidden="true" />
            ) : (
              <Search
                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            )}
            <div className="min-w-0 flex-1">
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-center gap-1 font-medium break-words hover:underline"
              >
                <span className="truncate">{s.title}</span>
                <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
              </a>
              <p className="truncate text-xs text-muted-foreground">
                {s.hostname} ·{" "}
                {s.evidence_type === "opened_page" ? "страница открыта" : "только из выдачи поиска"}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {failed.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Не удалось: {failed.map((r) => `${r.label} — ${r.error ?? "ошибка"}`).join("; ")}
        </p>
      )}
    </div>
  );
}
