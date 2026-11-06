import { AlertTriangle, RotateCcw, Settings2, WifiOff, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ChatError } from "@/lib/kimi/errors";

const CONFIG_CODES = new Set([
  "not_configured",
  "invalid_api_key",
  "model_forbidden",
  "not_found",
  "connection_failed",
  "payment_required",
]);

export function ErrorCard({
  error,
  onRetry,
  onDismiss,
  onOpenSettings,
}: {
  error: ChatError;
  onRetry?: () => void;
  onDismiss?: () => void;
  onOpenSettings?: () => void;
}) {
  const Icon = error.source === "network" ? WifiOff : AlertTriangle;
  const sourceLabel =
    error.source === "provider"
      ? "Ответ провайдера Kimi"
      : error.source === "network"
        ? "Соединение"
        : "Приложение";
  return (
    <div
      role="alert"
      className="rounded-xl border border-destructive/25 bg-danger-soft px-4 py-3.5 text-sm"
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p className="font-medium text-foreground">{error.title}</p>
            <span className="text-xs text-muted-foreground">{sourceLabel}</span>
          </div>
          <p className="mt-1 text-muted-foreground">{error.message}</p>
          {error.detail && (
            <p className="mt-2 break-words rounded-md bg-background/60 px-2.5 py-1.5 font-mono text-xs text-muted-foreground">
              {error.detail}
            </p>
          )}
          {(onRetry || (onOpenSettings && CONFIG_CODES.has(error.code))) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {onRetry && (
                <Button size="sm" variant="outline" onClick={onRetry}>
                  <RotateCcw /> Повторить
                </Button>
              )}
              {onOpenSettings && CONFIG_CODES.has(error.code) && (
                <Button size="sm" variant="ghost" onClick={onOpenSettings}>
                  <Settings2 /> Настройки подключения
                </Button>
              )}
            </div>
          )}
        </div>
        {onDismiss && (
          <Button size="icon-xs" variant="quiet" onClick={onDismiss} aria-label="Скрыть ошибку">
            <X />
          </Button>
        )}
      </div>
    </div>
  );
}
