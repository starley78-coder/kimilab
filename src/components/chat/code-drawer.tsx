import { Check, Copy, Download, WrapText } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { downloadText } from "@/lib/chat/export";
import { cn } from "@/lib/utils";

export interface DrawerItem {
  /** Tab label and download file name. */
  name: string;
  language: string;
  code: string;
}

interface DrawerState {
  title: string;
  items: DrawerItem[];
  index: number;
}

interface CodeDrawerValue {
  openCode: (title: string, items: DrawerItem[], index?: number) => void;
}

const CodeDrawerContext = createContext<CodeDrawerValue | null>(null);

export function useCodeDrawer() {
  const ctx = useContext(CodeDrawerContext);
  if (!ctx) throw new Error("useCodeDrawer must be used inside CodeDrawerProvider");
  return ctx;
}

function CodeView({ item, wrap }: { item: DrawerItem; wrap: boolean }) {
  const lines = useMemo(() => item.code.split("\n"), [item.code]);
  const gutter = String(lines.length).length;
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-muted/40 scrollbar-thin">
      <pre className="py-3 font-mono text-[0.8rem] leading-relaxed">
        <code>
          {lines.map((line, i) => (
            <div key={i} className="flex hover:bg-muted">
              <span
                className="sticky left-0 shrink-0 select-none bg-muted/90 pr-3 pl-3 text-right text-muted-foreground/70 tabular-nums"
                style={{ width: `${gutter + 2.5}ch` }}
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <span
                className={cn("pr-4", wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre")}
              >
                {line || " "}
              </span>
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}

export function CodeDrawerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DrawerState | null>(null);
  const [open, setOpen] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const openCode = useCallback((title: string, items: DrawerItem[], index = 0) => {
    if (!items.length) return;
    setState({ title, items, index: Math.min(index, items.length - 1) });
    setOpen(true);
  }, []);
  const value = useMemo(() => ({ openCode }), [openCode]);
  const current = state?.items[state.index];

  return (
    <CodeDrawerContext.Provider value={value}>
      {children}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-3 p-4 sm:max-w-2xl lg:max-w-3xl"
        >
          <SheetHeader className="pr-8 text-left">
            <SheetTitle className="truncate">{state?.title ?? "Код"}</SheetTitle>
            <SheetDescription className="text-xs">
              {current
                ? `${current.language || "text"} · ${current.code.split("\n").length} строк`
                : ""}
            </SheetDescription>
          </SheetHeader>
          {state && state.items.length > 1 && (
            <div
              role="tablist"
              aria-label="Блоки кода"
              className="flex gap-1 overflow-x-auto pb-1 scrollbar-thin"
            >
              {state.items.map((item, i) => (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={i === state.index}
                  onClick={() => setState({ ...state, index: i })}
                  className={cn(
                    "shrink-0 rounded-md px-2.5 py-1 font-mono text-xs transition-colors",
                    i === state.index
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.name}
                </button>
              ))}
            </div>
          )}
          {current && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(current.code);
                      setCopied(true);
                    } catch {
                      toast.error("Не удалось скопировать");
                    }
                  }}
                >
                  {copied ? <Check className="text-success" /> : <Copy />}
                  {copied ? "Скопировано" : "Копировать"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    downloadText(current.name, current.code, "text/plain;charset=utf-8")
                  }
                >
                  <Download /> Скачать {current.name}
                </Button>
                <Button
                  size="sm"
                  variant={wrap ? "secondary" : "ghost"}
                  aria-pressed={wrap}
                  onClick={() => setWrap((w) => !w)}
                >
                  <WrapText /> Перенос строк
                </Button>
              </div>
              <CodeView item={current} wrap={wrap} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </CodeDrawerContext.Provider>
  );
}
