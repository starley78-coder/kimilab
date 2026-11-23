import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, CircleAlert, Loader2, Monitor, Moon, PlugZap, Sun } from "lucide-react";

import { ErrorCard } from "@/components/chat/error-card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { kimiStatusQuery } from "@/lib/chat/data";
import { checkKimiConnection } from "@/lib/kimi.functions";
import {
  MODEL_DISPLAY_NAME,
  REASONING_EFFORTS,
  REASONING_EFFORT_HINTS,
  REASONING_EFFORT_LABELS,
} from "@/lib/kimi/config";
import { useReasoningEffort, useThemePreference } from "@/lib/preferences";
import type { ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

function Section({
  title,
  children,
  hint,
}: {
  title: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <section className="grid gap-2.5">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode; hint?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-muted p-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex flex-col items-center gap-0.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors",
            value === o.value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span className="flex items-center gap-1.5">
            {o.icon}
            {o.label}
          </span>
        </button>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right">{children}</span>
    </div>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [effort, setEffort] = useReasoningEffort();
  const [theme, setTheme] = useThemePreference();
  const status = useQuery({ ...kimiStatusQuery(), enabled: open });
  const check = useServerFn(checkKimiConnection);
  const connection = useMutation({ mutationFn: () => check() });

  const s = status.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Настройки</DialogTitle>
          <DialogDescription>Модель, рассуждения, подключение и оформление.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-6">
          <Section title="Модель">
            <div className="rounded-xl border bg-card px-4 py-2">
              <Row label="Модель">
                <span className="font-medium">{MODEL_DISPLAY_NAME}</span>
              </Row>
              <Row label="ID модели">
                <code className="font-mono text-xs">{s?.modelId ?? "—"}</code>
              </Row>
              <Row label="Провайдер">{s?.providerLabel ?? "—"}</Row>
              <Row label="Адрес API">
                <code className="font-mono text-xs">{s?.host ?? "—"}</code>
              </Row>
              <Row label="API-ключ">
                {status.isPending ? (
                  <Loader2 className="inline size-3.5 animate-spin" />
                ) : s?.keyConfigured ? (
                  <span className="inline-flex items-center gap-1 text-success">
                    <CheckCircle2 className="size-3.5" /> задан на сервере
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-destructive">
                    <CircleAlert className="size-3.5" /> не задан
                  </span>
                )}
              </Row>
            </div>
            {s && !s.configured && (
              <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-foreground">
                Не хватает серверных секретов: {[...s.missing, ...s.invalid].join(", ")}. Ключ
                хранится только на сервере и никогда не передаётся в браузер.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => connection.mutate()}
                disabled={connection.isPending || !s?.configured}
              >
                {connection.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />}
                Проверить подключение
              </Button>
              {connection.data?.ok && (
                <span className="inline-flex items-center gap-1.5 text-xs text-success">
                  <CheckCircle2 className="size-3.5" />
                  Ключ принят · {connection.data.latencyMs} мс
                  {connection.data.modelListed === true && " · модель доступна"}
                </span>
              )}
            </div>
            {connection.data?.ok && connection.data.modelListed === false && (
              <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-foreground">
                Ключ работает, но модели «{s?.modelId}» нет в списке, который вернул провайдер.
                Проверьте KIMI_MODEL_ID.
              </p>
            )}
            {connection.data?.error && <ErrorCard error={connection.data.error} />}
            {connection.isError && (
              <ErrorCard
                error={{
                  source: "app",
                  status: 0,
                  code: "check_failed",
                  title: "Проверка не выполнена",
                  message: connection.error instanceof Error ? connection.error.message : "Ошибка",
                }}
              />
            )}
            <p className="text-xs text-muted-foreground">
              Проверка запрашивает список моделей и не расходует токены.
            </p>
          </Section>

          <Section
            title="Уровень рассуждений"
            hint="Передаётся в параметре reasoning_effort. Режим Thinking у Kimi K3.1 Pro всегда включён; внутренние рассуждения не показываются — только итоговый ответ."
          >
            <Segmented
              label="Уровень рассуждений"
              value={effort}
              onChange={setEffort}
              options={REASONING_EFFORTS.map((e) => ({
                value: e,
                label: REASONING_EFFORT_LABELS[e],
              }))}
            />
            <p className="text-xs text-muted-foreground">{REASONING_EFFORT_HINTS[effort]}</p>
          </Section>

          <Section title="Тема">
            <Segmented<ThemePreference>
              label="Тема"
              value={theme}
              onChange={setTheme}
              options={[
                { value: "light", label: "Светлая", icon: <Sun className="size-3.5" /> },
                { value: "dark", label: "Тёмная", icon: <Moon className="size-3.5" /> },
                { value: "system", label: "Системная", icon: <Monitor className="size-3.5" /> },
              ]}
            />
          </Section>

          <Section title="Ограничения и расход">
            <ul className="grid gap-1.5 text-xs text-muted-foreground">
              <li>Ограничение приложения: до 10 запросов в минуту и 500 в сутки.</li>
              <li>
                Токены показываются из поля usage, которое возвращает API. Стоимость не
                рассчитывается.
              </li>
              <li>
                Изображения хранятся в приватном хранилище, в истории сохраняется только текст и
                ссылки на файлы.
              </li>
            </ul>
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
