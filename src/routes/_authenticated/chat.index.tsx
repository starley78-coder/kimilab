import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight, KeyRound } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { ChatHeader } from "@/components/chat/chat-header";
import { useChatRuntime } from "@/components/chat/chat-runtime";
import { Composer } from "@/components/chat/composer";
import { useSettings } from "@/components/chat/settings-context";
import { Button } from "@/components/ui/button";
import { kimiStatusQuery } from "@/lib/chat/data";
import { MODEL_DISPLAY_NAME } from "@/lib/kimi/config";

export const Route = createFileRoute("/_authenticated/chat/")({
  head: () => ({
    meta: [
      { title: "Новый диалог — Kimi Lab" },
      { name: "description", content: "Начните новый диалог с Kimi K3.1 Pro." },
      { property: "og:title", content: "Новый диалог — Kimi Lab" },
      { property: "og:description", content: "Начните новый диалог с Kimi K3.1 Pro." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NewChatPage,
});

const STARTERS = [
  {
    title: "Сравни в таблице",
    text: "Сравни в таблице PostgreSQL, MySQL и SQLite: сильные стороны, ограничения, когда что выбирать.",
  },
  {
    title: "Напиши код",
    text: "Напиши на TypeScript функцию debounce с отменой и тестами на Vitest.",
  },
  {
    title: "Разбери идею",
    text: "Помоги критически разобрать идею: какие допущения стоит проверить первыми?",
  },
  {
    title: "План обучения",
    text: "Составь план изучения Rust на 4 недели для разработчика на Python.",
  },
];

function NewChatPage() {
  const status = useQuery(kimiStatusQuery());
  const { send } = useChatRuntime();
  const { openSettings } = useSettings();
  const notConfigured = status.data && !status.data.configured;

  return (
    <>
      <ChatHeader />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-thin">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-10">
          <div className="flex flex-col items-center text-center">
            <BrandMark className="size-12" />
            <h2 className="mt-5 text-2xl font-semibold tracking-tight sm:text-[1.7rem]">
              Чем займёмся?
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {MODEL_DISPLAY_NAME} · режим Thinking всегда включён, в чате показывается только
              итоговый ответ
            </p>
          </div>

          {notConfigured && (
            <div className="mx-auto mt-8 flex w-full max-w-xl items-start gap-3 rounded-xl border bg-warning-soft px-4 py-3 text-sm">
              <KeyRound className="mt-0.5 size-4 shrink-0 text-warning" />
              <div className="flex-1">
                <p className="font-medium">Подключение к Kimi не настроено</p>
                <p className="mt-0.5 text-muted-foreground">
                  Не хватает серверных секретов:{" "}
                  {[...status.data.missing, ...status.data.invalid].join(", ")}.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={openSettings}>
                Подробнее
              </Button>
            </div>
          )}

          <div className="mt-10 grid gap-2.5 sm:grid-cols-2">
            {STARTERS.map((s) => (
              <button
                key={s.title}
                type="button"
                onClick={() =>
                  void send({ conversationId: null, text: s.text, files: [] }).catch(
                    () => undefined,
                  )
                }
                className="group rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:border-ring/40 hover:bg-accent"
              >
                <span className="flex items-center justify-between text-sm font-medium">
                  {s.title}
                  <ArrowUpRight className="size-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </span>
                <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">
                  {s.text}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="shrink-0 px-3 pb-3 sm:px-4 sm:pb-4">
        <div className="mx-auto max-w-3xl">
          <Composer conversationId={null} />
        </div>
      </div>
    </>
  );
}
