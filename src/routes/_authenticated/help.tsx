import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/help")({
  head: () => ({
    meta: [
      { title: "Помощь — Kimi Lab" },
      {
        name: "description",
        content: "Как пользоваться Kimi Lab: рассуждения, файлы, контекст, баланс, резюме и копии.",
      },
      { property: "og:title", content: "Помощь — Kimi Lab" },
      {
        property: "og:description",
        content: "Справка по Kimi Lab и возможностям Kimi K3.1 Pro.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: HelpPage,
});

const SECTIONS: { id: string; title: string; body: ReactNode }[] = [
  {
    id: "start",
    title: "Начало работы",
    body: (
      <>
        <p>
          Напишите вопрос и нажмите Enter. Ответ приходит потоком; кнопка с квадратом
          останавливает генерацию, уже полученный текст сохраняется.
        </p>
        <p>
          Kimi K3.1 Pro всегда «думает» перед ответом. Ход рассуждений в чате не показывается —
          только итоговый ответ.
        </p>
      </>
    ),
  },
  {
    id: "effort",
    title: "Уровень рассуждений",
    body: (
      <ul>
        <li>
          <b>Low</b> — быстрее и дешевле; для простых вопросов, переводов, правок текста.
        </li>
        <li>
          <b>High</b> — по умолчанию в приложении; хороший баланс для большинства задач.
        </li>
        <li>
          <b>Max</b> — самые глубокие рассуждения (так API работает по умолчанию); для сложного
          кода, математики и анализа. Дольше и тратит больше токенов.
        </li>
      </ul>
    ),
  },
  {
    id: "files",
    title: "Картинки и файлы",
    body: (
      <>
        <p>
          Картинки PNG, JPG и WebP — до 4 в сообщении. Их можно вставить из буфера (Ctrl+V) или
          перетащить в окно.
        </p>
        <p>
          Текстовые файлы и код (.txt, .md, .py, .ts, .json, .csv и другие) — до 5 файлов по 200 КБ.
          Kimi читает их как текст.
        </p>
      </>
    ),
  },
  {
    id: "instructions",
    title: "Инструкции",
    body: (
      <p>
        Инструкция по умолчанию задаётся в настройках и действует во всех диалогах. Для
        отдельного диалога можно задать свою — кнопка со свитком в шапке диалога.
      </p>
    ),
  },
  {
    id: "context",
    title: "Окно контекста и кэш",
    body: (
      <>
        <p>
          У Kimi K3.1 Pro окно 1 000 000 токенов. Индикатор в шапке показывает, сколько занял
          последний запрос, и сколько осталось. От 80% он становится оранжевым, от 95% — красным:
          сделайте резюме и продолжите в новом диалоге.
        </p>
        <p>
          Под полем ввода видна оценка черновика «≈ N ток.» — её считает токенизатор Kimi, это
          бесплатно.
        </p>
        <p>
          Kimi автоматически кэширует повторяющееся начало запроса (историю диалога). Такие токены
          стоят в 10 раз дешевле; их число видно в подсказке к расходу ответа — «из кэша».
        </p>
      </>
    ),
  },
  {
    id: "balance",
    title: "Баланс",
    body: (
      <>
        <p>
          Значок с кошельком в шапке — доступный баланс аккаунта Kimi в долларах (деньги +
          ваучеры). Он обновляется раз в 5 минут и после каждого ответа. Жёлтый — меньше $1,
          красный — баланс исчерпан, и Kimi не будет отвечать.
        </p>
        <p>
          Баланс доступен только через официальный API Moonshot. Лимиты частоты (RPM, TPM)
          зависят от суммы пополнений на платформе Kimi.
        </p>
      </>
    ),
  },
  {
    id: "summary",
    title: "Резюме и шаги",
    body: (
      <p>
        В меню диалога (три точки) выберите «Резюме и шаги». Lovable AI прочитает сообщения и
        составит краткое резюме и список дальнейших действий. Последнее резюме сохраняется. Эта
        функция тратит кредиты Lovable, а не баланс Kimi.
      </p>
    ),
  },
  {
    id: "organize",
    title: "Закрепление, архив, экспорт",
    body: (
      <>
        <p>
          Диалог можно закрепить наверху списка или убрать в архив. Экспорт в Markdown или JSON —
          в меню диалога.
        </p>
        <p>
          Полная резервная копия всех диалогов — в настройках. Восстановленные диалоги
          добавляются как новые; картинки в копию не входят.
        </p>
      </>
    ),
  },
  {
    id: "errors",
    title: "Если что-то пошло не так",
    body: (
      <ul>
        <li>
          <b>401</b> — ключ Kimi не принят. Проверьте секрет KIMI_API_KEY.
        </li>
        <li>
          <b>429 «Закончился баланс Kimi»</b> — пополните счёт на platform.kimi.ai.
        </li>
        <li>
          <b>429 лимит запросов</b> — подождите: приложение само отсчитывает время и повторит
          запрос. Лимит приложения — 10 запросов в минуту и 500 в сутки.
        </li>
        <li>
          <b>5xx</b> — сбой на стороне Kimi, повторите позже.
        </li>
      </ul>
    ),
  },
  {
    id: "keys",
    title: "Клавиши",
    body: (
      <ul>
        <li>Enter — отправить, Shift+Enter — новая строка.</li>
        <li>Ctrl+V — вставить картинку из буфера.</li>
      </ul>
    ),
  },
];

function HelpPage() {
  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/chat">
            <ArrowLeft /> К диалогам
          </Link>
        </Button>
        <div className="mt-6 flex items-center gap-3">
          <BrandMark className="size-9" />
          <h1 className="text-2xl font-semibold tracking-tight">Помощь</h1>
        </div>
        <nav aria-label="Разделы" className="mt-6 flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {s.title}
            </a>
          ))}
        </nav>
        <div className="mt-8 grid gap-8">
          {SECTIONS.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-6">
              <h2 className="text-base font-semibold">{s.title}</h2>
              <div className="mt-2 grid gap-2 text-sm leading-relaxed text-muted-foreground [&_b]:text-foreground [&_li]:ml-4 [&_li]:list-disc [&_ul]:grid [&_ul]:gap-1">
                {s.body}
              </div>
            </section>
          ))}
        </div>
        <a
          href="https://platform.kimi.ai/docs/guide/kimi-k3-1-pro-quickstart"
          target="_blank"
          rel="noreferrer"
          className="mt-10 inline-flex items-center gap-1.5 text-sm text-signal hover:underline"
        >
          Документация Kimi K3.1 Pro <ExternalLink className="size-3.5" />
        </a>
      </div>
    </div>
  );
}
