/**
 * Maps provider and app failures to clear, user-facing messages.
 * Never include secrets: provider text is sanitized before it is shown.
 */

export type ChatErrorSource = "provider" | "app" | "network";

export interface ChatError {
  source: ChatErrorSource;
  /** HTTP status returned by the provider (or by this app for app errors). 0 = no response. */
  status: number;
  code: string;
  title: string;
  message: string;
  /** Sanitized provider detail, if any. */
  detail?: string | undefined;
  retryAfter?: number | undefined;
}

const KEY_PATTERNS: RegExp[] = [
  // Account and key identifiers some providers echo back in error text
  /<?\bak-[A-Za-z0-9]{6,}>?/g,
  /\borg-[A-Za-z0-9]{6,}/g,
  /sk-[A-Za-z0-9_-]{8,}/g,
  /Bearer\s+[A-Za-z0-9._-]{8,}/gi,
  /(api[_-]?key["'\s:=]+)[A-Za-z0-9._-]{8,}/gi,
];

export function sanitizeProviderText(
  text: string | undefined | null,
  secrets: string[] = [],
): string {
  if (!text) return "";
  let out = String(text);
  for (const secret of secrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join("[скрыто]");
  }
  for (const pattern of KEY_PATTERNS) {
    out = out.replace(pattern, (match, prefix?: string) =>
      typeof prefix === "string" && match.startsWith(prefix) ? `${prefix}[скрыто]` : "[скрыто]",
    );
  }
  out = out.replace(/\s+/g, " ").trim();
  return out.length > 400 ? `${out.slice(0, 400)}…` : out;
}

/** Pulls a human-readable message out of an OpenAI-compatible error body. */
export function extractProviderMessage(body: string): string {
  if (!body) return "";
  try {
    const json = JSON.parse(body) as unknown;
    if (json && typeof json === "object") {
      const obj = json as Record<string, unknown>;
      const err = obj["error"];
      if (typeof err === "string") return err;
      if (err && typeof err === "object") {
        const msg = (err as Record<string, unknown>)["message"];
        if (typeof msg === "string") return msg;
      }
      const msg = obj["message"] ?? obj["detail"];
      if (typeof msg === "string") return msg;
    }
  } catch {
    // not JSON
  }
  return body.slice(0, 400);
}

export function describeProviderError(
  status: number,
  detail?: string,
  retryAfter?: number,
): ChatError {
  const base = { source: "provider" as const, status, detail: detail || undefined, retryAfter };
  switch (status) {
    case 400:
      return {
        ...base,
        code: "bad_request",
        title: "400 — запрос отклонён провайдером",
        message:
          "Провайдер не принял параметры запроса. Проверьте детали ниже — например, формат изображения или параметры модели.",
      };
    case 401:
      return {
        ...base,
        code: "invalid_api_key",
        title: "401 — проблема с API-ключом",
        message:
          "Провайдер не принял ключ KIMI_API_KEY. Проверьте, что ключ действителен и соответствует выбранному провайдеру (Moonshot или kineticRouter).",
      };
    case 402:
      return {
        ...base,
        code: "payment_required",
        title: "402 — недостаточно средств",
        message: "Провайдер сообщил о нехватке баланса на аккаунте. Пополните баланс у провайдера.",
      };
    case 403:
      return {
        ...base,
        code: "model_forbidden",
        title: "403 — нет доступа к модели",
        message:
          "Ключ действителен, но у аккаунта нет доступа к модели Kimi K3.1 Pro. Проверьте права доступа у провайдера.",
      };
    case 404:
      return {
        ...base,
        code: "not_found",
        title: "404 — неверный идентификатор модели или endpoint",
        message:
          "Провайдер не нашёл модель или адрес. Проверьте KIMI_MODEL_ID и KIMI_API_BASE_URL (адрес должен заканчиваться на /v1).",
      };
    case 408:
    case 504:
      return {
        ...base,
        code: "timeout",
        title: `${status} — превышено время ожидания`,
        message:
          "Провайдер не успел ответить. Попробуйте ещё раз или выберите уровень рассуждений Low.",
      };
    case 413:
      return {
        ...base,
        code: "payload_too_large",
        title: "413 — слишком большой запрос",
        message: "Запрос слишком велик. Уменьшите изображение или начните новый диалог.",
      };
    case 422:
      return {
        ...base,
        code: "unprocessable",
        title: "422 — некорректные параметры",
        message: "Провайдер не смог обработать параметры запроса.",
      };
    case 429:
      return {
        ...base,
        code: "provider_rate_limited",
        title: "429 — превышен лимит запросов",
        message: retryAfter
          ? `Провайдер ограничил частоту или число одновременных запросов. Повторите через ${retryAfter} с.`
          : "Провайдер ограничил частоту запросов или исчерпана квота. Подождите и повторите.",
      };
    case 500:
    case 502:
    case 503:
      return {
        ...base,
        code: "provider_unavailable",
        title: `${status} — ошибка сервиса провайдера`,
        message:
          "На стороне провайдера произошла ошибка или сервис временно недоступен. Повторите позже.",
      };
    default:
      if (status >= 500) {
        return {
          ...base,
          code: "provider_unavailable",
          title: `${status} — ошибка сервиса провайдера`,
          message: "Провайдер вернул ошибку сервера. Повторите позже.",
        };
      }
      return {
        ...base,
        code: "provider_error",
        title: `${status} — ошибка провайдера`,
        message: "Провайдер вернул неожиданную ошибку.",
      };
  }
}

/** Kimi's `exceeded_current_quota_error`: the account balance or token quota is used up. */
export function balanceExhaustedError(detail?: string): ChatError {
  return {
    source: "provider",
    status: 429,
    code: "balance_exhausted",
    title: "Закончился баланс Kimi",
    message:
      "Провайдер отклонил запрос: на аккаунте Kimi закончились средства или квота токенов. Пополните баланс на platform.kimi.ai и повторите.",
    detail: detail || undefined,
  };
}

export function connectionError(detail?: string): ChatError {
  return {
    source: "network",
    status: 0,
    code: "connection_failed",
    title: "Нет соединения с провайдером",
    message:
      "Не удалось подключиться к API Kimi. Проверьте KIMI_API_BASE_URL и доступность сервиса провайдера.",
    detail: detail || undefined,
  };
}

export function appError(
  status: number,
  code: string,
  title: string,
  message: string,
  extra: Partial<ChatError> = {},
): ChatError {
  return { source: "app", status, code, title, message, ...extra };
}

export function rateLimitedError(
  retryAfter: number,
  scope: "minute" | "day",
  limit: number,
): ChatError {
  return appError(
    429,
    "app_rate_limited",
    "429 — слишком много запросов",
    scope === "minute"
      ? `Ограничение приложения: не больше ${limit} запросов в минуту. Повторите через ${retryAfter} с.`
      : `Ограничение приложения: не больше ${limit} запросов в сутки. Лимит обновится позже.`,
    { retryAfter },
  );
}

export function isChatError(value: unknown): value is ChatError {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as ChatError).title === "string" &&
    typeof (value as ChatError).message === "string" &&
    typeof (value as ChatError).status === "number"
  );
}
