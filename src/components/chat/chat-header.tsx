import { Settings2 } from "lucide-react";
import type { ReactNode } from "react";

import { BalanceBadge } from "@/components/chat/balance-badge";
import { useSettings } from "@/components/chat/settings-context";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function ChatHeader({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  const { openSettings } = useSettings();
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-transparent bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-4">
      <SidebarTrigger
        className="-ml-1 text-muted-foreground"
        aria-label="Показать или скрыть список диалогов"
      />
      <div className="min-w-0 flex-1">
        {title && <h1 className="truncate text-sm font-medium">{title}</h1>}
      </div>
      {children}
      <BalanceBadge />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="quiet" size="icon-sm" onClick={openSettings} aria-label="Настройки">
            <Settings2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Настройки</TooltipContent>
      </Tooltip>
    </header>
  );
}
