import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  CircleAlert,
  Download,
  LifeBuoy,
  Loader2,
  Monitor,
  Moon,
  PlugZap,
  Sun,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Link } from "@tanstack/react-router";

import { formatUsd } from "@/components/chat/balance-badge";
import { ErrorCard } from "@/components/chat/error-card";
import { PresetPicker } from "@/components/chat/thread-tools";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  conversationsQuery,
  importBackup,
  kimiBalanceQuery,
  kimiStatusQuery,
  loadEverything,
  saveDefaultSystemPrompt,
  userSettingsQuery,
} from "@/lib/chat/data";
import { buildBackup, downloadText, parseBackup } from "@/lib/chat/export";
import { formatTokens } from "@/lib/format";
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

const MAX_PROMPT = 20_000;

function DefaultPromptSection({ userId, open }: { userId: string; open: boolean }) {
  const queryClient = useQueryClient();
  const settings = useQuery({ ...userSettingsQuery(), enabled: open });
  const [value, setValue] = useState("");
  const saved = settings.data?.default_system_prompt ?? "";
  useEffect(() => {
    if (settings.data) setValue(settings.data.default_system_prompt);
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () => saveDefaultSystemPrompt(userId, value),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: userSettingsQuery().queryKey });
      toast.success(
        value.trim() ? "Инструкция по умолчанию сохранена" : "Инструкция по умолчанию очищена",
      );
    },
    onError: (e) => toast.error("Не удалось сохранить", { description: e.message }),
  });
  const dirty = value.trim() !== saved.trim();
  return (
    <Section
      title="Системная инструкция по умолчанию"
      hint="Отправляется первой (role: system) во всех диалогах, где не задана своя инструкция."
    >
      <PresetPicker onPick={setValue} />
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Например: «Отвечай кратко, по-русски. Код — на TypeScript со строгой типизацией.»"
        className="max-h-64 min-h-24 text-sm"
        maxLength={MAX_PROMPT}
        disabled={settings.isPending}
        aria-label="Системная инструкция по умолчанию"
      />
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />} Сохранить
        </Button>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {value.length.toLocaleString("ru-RU")} / {MAX_PROMPT.toLocaleString("ru-RU")}
        </span>
      </div>
    </Section>
  );
}

function BalanceValue() {
  const q = useQuery(kimiBalanceQuery());
  if (q.isPending) return <Loader2 className="inline size-3.5 animate-spin" />;
  const r = q.data;
  if (!r?.supported) return <span className="text-muted-foreground">недоступен у провайдера</span>;
  if (!r.balance) return <span className="text-destructive">{r.error?.title ?? "не получен"}</span>;
  return (
    <span className="font-mono text-xs">
      {formatUsd(r.balance.available)}
      <span className="text-muted-foreground">
        {" "}
        (ваучеры {formatUsd(r.balance.voucher)}, счёт {formatUsd(r.balance.cash)})
      </span>
    </span>
  );
}

function DataSection() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const exportAll = useMutation({
    mutationFn: async () => {
      const { conversations, messages } = await loadEverything();
      const stamp = new Date().toISOString().slice(0, 10);
      downloadText(
        `kimi-lab-backup-${stamp}.json`,
        JSON.stringify(buildBackup(conversations, messages), null, 2),
        "application/json",
      );
      window.__lovableEvents?.track?.("project.conversation_exported", { format: "backup" });
      return { conversations: conversations.length, messages: messages.length };
    },
    onSuccess: (r) =>
      toast.success(`Сохранено: ${r.conversations} диалогов, ${r.messages} сообщений`),
    onError: (e) => toast.error("Экспорт не удался", { description: e.message }),
  });
  const importAll = useMutation({
    mutationFn: async (file: File) => {
      const parsed = parseBackup(await file.text());
      if (!parsed.ok) throw new Error(parsed.error);
      return importBackup(parsed.backup, (done, total) => setProgress(`${done} из ${total}`));
    },
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: conversationsQuery().queryKey });
      toast.success(`Восстановлено: ${r.conversations} диалогов, ${r.messages} сообщений`);
    },
    onError: (e) => toast.error("Импорт не удался", { description: e.message }),
    onSettled: () => setProgress(null),
  });
  return (
    <Section
      title="Данные"
      hint="Резервная копия — JSON со всеми диалогами, инструкциями и данными usage. Изображения в неё не входят."
    >
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => exportAll.mutate()}
          disabled={exportAll.isPending}
        >
          {exportAll.isPending ? <Loader2 className="animate-spin" /> : <Download />}
          Скачать резервную копию
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => fileInput.current?.click()}
          disabled={importAll.isPending}
        >
          {importAll.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
          {importAll.isPending && progress ? `Импорт: ${progress}` : "Восстановить из файла"}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (f) importAll.mutate(f);
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Восстановленные диалоги добавляются как новые — существующие не изменяются.
      </p>
    </Section>
  );
}

export function SettingsDialog({
  userId,
  open,
  onOpenChange,
}: {
  userId: string;
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
          <DialogDescription>
            Модель, инструкции, рассуждения, данные и оформление.
          </DialogDescription>
        </DialogHeader>

        <Link
          to="/help"
          onClick={() => onOpenChange(false)}
          className="inline-flex items-center gap-1.5 text-sm text-signal hover:underline"
        >
          <LifeBuoy className="size-4" /> Помощь и советы
        </Link>
        <div className="grid gap-6">
          <Section title="Модель">
            <div className="rounded-xl border bg-card px-4 py-2">
              <Row label="Модель">
                <span className="font-medium">{MODEL_DISPLAY_NAME}</span>
              </Row>
              <Row label="ID модели">
                <code className="font-mono text-xs">{s?.modelId ?? "—"}</code>
              </Row>
              <Row label="Контекстное окно">
                {s?.contextWindow ? (
                  `${formatTokens(s.contextWindow)} токенов`
                ) : (
                  <span className="text-muted-foreground">не задано</span>
                )}
              </Row>
              <Row label="Баланс">
                <BalanceValue />
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

          <DefaultPromptSection userId={userId} open={open} />

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

          <DataSection />

          <Section title="Ограничения и расход">
            <ul className="grid gap-1.5 text-xs text-muted-foreground">
              <li>Ограничение приложения: до 10 запросов в минуту и 500 в сутки.</li>
              <li>
                Токены показываются из поля usage, которое возвращает API. Стоимость не
                рассчитывается.
              </li>
              <li>
                Размер окна контекста берётся из серверного секрета KIMI_CONTEXT_WINDOW (для Kimi
                K3.1 Pro по документации — 1 000 000 токенов).
              </li>
              <li>Баланс берётся из API Kimi и доступен только для официального API Moonshot.</li>
              <li>«Резюме и шаги» делает Lovable AI и тратит кредиты Lovable, а не баланс Kimi.</li>
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
