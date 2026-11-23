import { useQuery } from "@tanstack/react-query";
import { Wallet } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { kimiBalanceQuery } from "@/lib/chat/data";
import { balanceLevel } from "@/lib/kimi/balance";
import { cn } from "@/lib/utils";

export function formatUsd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Live Kimi account balance in the header. Hidden when the provider has no balance API. */
export function BalanceBadge() {
  const q = useQuery(kimiBalanceQuery());
  const r = q.data;
  if (!r || !r.supported) return null;
  if (!r.balance) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-default items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-[0.7rem] text-muted-foreground">
            <Wallet className="size-3.5" /> —
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-64 text-xs">
          <p className="font-medium">Баланс Kimi не получен</p>
          <p className="mt-1 opacity-80">{r.error?.title ?? "Нет данных"}</p>
        </TooltipContent>
      </Tooltip>
    );
  }
  const level = balanceLevel(r.balance.available);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={`Баланс Kimi ${formatUsd(r.balance.available)}`}
          className={cn(
            "inline-flex cursor-default items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[0.7rem] tabular-nums",
            level === "ok" && "bg-card text-muted-foreground",
            level === "low" && "border-warning/50 bg-warning-soft text-foreground",
            level === "empty" && "border-destructive/50 bg-destructive/10 text-destructive",
          )}
        >
          <Wallet className="size-3.5" />
          {formatUsd(r.balance.available)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-64 text-xs">
        <p className="font-medium">Баланс аккаунта Kimi</p>
        <div className="mt-1 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
          <span>Доступно</span>
          <span className="text-right font-mono">{formatUsd(r.balance.available)}</span>
          <span>Ваучеры</span>
          <span className="text-right font-mono">{formatUsd(r.balance.voucher)}</span>
          <span>Деньги на счёте</span>
          <span className="text-right font-mono">{formatUsd(r.balance.cash)}</span>
        </div>
        <p className="mt-1.5 opacity-70">
          {level === "empty"
            ? "Баланс исчерпан — Kimi не примет запросы. Пополните на platform.kimi.ai."
            : level === "low"
              ? "Осталось меньше $1 — скоро понадобится пополнение."
              : "Данные API Kimi. Обновляется раз в 5 минут и после каждого ответа."}
        </p>
        <p className="mt-0.5 opacity-50">
          Проверено {new Date(r.checkedAt).toLocaleTimeString("ru-RU")}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
