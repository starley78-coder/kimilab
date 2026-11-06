import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  Check,
  ChevronsUpDown,
  LogOut,
  MessageSquareDashed,
  Monitor,
  Moon,
  MoreHorizontal,
  Pencil,
  Search,
  Settings2,
  SquarePen,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { useDeferredValue, useEffect, useState } from "react";

import { BrandWordmark } from "@/components/brand-mark";
import { isTurnActive, useLiveTurns } from "@/components/chat/chat-runtime";
import { DeleteConversationDialog, RenameConversationDialog } from "@/components/chat/conversation-dialogs";
import { useSettings } from "@/components/chat/settings-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { supabase } from "@/integrations/supabase/client";
import { conversationsQuery, searchHistory, type ConversationRow } from "@/lib/chat/data";
import { groupByDate } from "@/lib/format";
import { useThemePreference } from "@/lib/preferences";
import type { ThemePreference } from "@/lib/theme";

function useCloseOnMobile() {
  const { isMobile, setOpenMobile } = useSidebar();
  return () => {
    if (isMobile) setOpenMobile(false);
  };
}

function ConversationItem({
  conversation,
  active,
  live,
  onRename,
  onDelete,
}: {
  conversation: ConversationRow;
  active: boolean;
  live: boolean;
  onRename: () => void;
  onDelete: () => void;
}) {
  const closeOnMobile = useCloseOnMobile();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} className="h-9 pr-8">
        <Link
          to="/chat/$conversationId"
          params={{ conversationId: conversation.id }}
          onClick={closeOnMobile}
          title={conversation.title}
        >
          <span className="truncate">{conversation.title}</span>
          {live && (
            <span className="ml-auto size-1.5 shrink-0 animate-pulse rounded-full bg-signal" aria-label="Идёт генерация" />
          )}
        </Link>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover aria-label="Действия с диалогом">
            <MoreHorizontal />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-44">
          <DropdownMenuItem onSelect={onRename}>
            <Pencil /> Переименовать
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
            <Trash2 /> Удалить
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

function SearchResults({ query, activeId }: { query: string; activeId?: string | undefined }) {
  const closeOnMobile = useCloseOnMobile();
  const results = useQuery({
    queryKey: ["search", query],
    queryFn: () => searchHistory(query),
    staleTime: 10_000,
  });

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Результаты поиска</SidebarGroupLabel>
      <SidebarGroupContent>
        {results.isPending ? (
          <SidebarMenu>
            {Array.from({ length: 4 }).map((_, i) => (
              <SidebarMenuSkeleton key={i} />
            ))}
          </SidebarMenu>
        ) : results.isError ? (
          <p className="px-2 py-3 text-xs text-destructive">Поиск не удался: {results.error.message}</p>
        ) : results.data.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">Ничего не найдено по запросу «{query}»</p>
        ) : (
          <SidebarMenu>
            {results.data.map((hit) => (
              <SidebarMenuItem key={hit.conversationId}>
                <SidebarMenuButton
                  asChild
                  isActive={hit.conversationId === activeId}
                  className="h-auto flex-col items-start gap-0.5 py-2"
                >
                  <Link
                    to="/chat/$conversationId"
                    params={{ conversationId: hit.conversationId }}
                    onClick={closeOnMobile}
                  >
                    <span className="w-full truncate font-medium">{hit.title}</span>
                    {hit.snippet && (
                      <span className="line-clamp-2 w-full text-xs text-muted-foreground">{hit.snippet}</span>
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function AccountMenu({ email }: { email: string }) {
  const [theme, setTheme] = useThemePreference();
  const { openSettings } = useSettings();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/auth", replace: true });
  };

  const themes: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
    { value: "light", label: "Светлая", icon: <Sun /> },
    { value: "dark", label: "Тёмная", icon: <Moon /> },
    { value: "system", label: "Системная", icon: <Monitor /> },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent text-xs font-semibold uppercase">
            {email.slice(0, 1)}
          </span>
          <span className="grid min-w-0 flex-1 text-left leading-tight">
            <span className="truncate text-sm font-medium">{email}</span>
            <span className="truncate text-xs text-muted-foreground">Владелец</span>
          </span>
          <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-[--radix-dropdown-menu-trigger-width] min-w-56">
        <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={openSettings}>
          <Settings2 /> Настройки
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {theme === "dark" ? <Moon /> : theme === "light" ? <Sun /> : <Monitor />}
            Тема
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {themes.map((t) => (
              <DropdownMenuItem key={t.value} onSelect={() => setTheme(t.value)}>
                {t.icon} {t.label}
                {theme === t.value && <Check className="ml-auto" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut /> Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppSidebar({ email }: { email: string }) {
  const params = useParams({ strict: false }) as { conversationId?: string };
  const activeId = params.conversationId;
  const conversations = useQuery(conversationsQuery());
  const liveTurns = useLiveTurns();
  const closeOnMobile = useCloseOnMobile();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const deferred = useDeferredValue(debounced);
  const [renaming, setRenaming] = useState<ConversationRow | null>(null);
  const [deleting, setDeleting] = useState<ConversationRow | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const groups = groupByDate(conversations.data ?? []);

  return (
    <>
      <Sidebar collapsible="offcanvas">
        <SidebarHeader className="gap-3 px-3 pt-3">
          <div className="flex h-8 items-center justify-between px-1">
            <Link to="/chat" onClick={closeOnMobile} aria-label="Kimi Lab — новый диалог">
              <BrandWordmark />
            </Link>
          </div>
          <Button asChild variant="outline" className="h-9 justify-start gap-2 rounded-lg bg-sidebar shadow-none">
            <Link to="/chat" onClick={closeOnMobile}>
              <SquarePen className="size-4" />
              Новый диалог
            </Link>
          </Button>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <SidebarInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по истории"
              aria-label="Поиск по истории"
              className="h-9 rounded-lg pr-8 pl-8"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                aria-label="Очистить поиск"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </SidebarHeader>

        <SidebarContent className="scrollbar-thin">
          {deferred ? (
            <SearchResults query={deferred} activeId={activeId} />
          ) : conversations.isPending ? (
            <SidebarGroup>
              <SidebarMenu>
                {Array.from({ length: 6 }).map((_, i) => (
                  <SidebarMenuSkeleton key={i} />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ) : conversations.isError ? (
            <p className="px-4 py-3 text-xs text-destructive">
              Не удалось загрузить диалоги: {conversations.error.message}
            </p>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-xs text-muted-foreground">
              <MessageSquareDashed className="size-5" />
              Диалогов пока нет. Начните новый — он сохранится здесь.
            </div>
          ) : (
            groups.map(({ group, items }) => (
              <SidebarGroup key={group} className="py-1">
                <SidebarGroupLabel>{group}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {items.map((c) => (
                      <ConversationItem
                        key={c.id}
                        conversation={c}
                        active={c.id === activeId}
                        live={isTurnActive(liveTurns.get(c.id))}
                        onRename={() => setRenaming(c)}
                        onDelete={() => setDeleting(c)}
                      />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))
          )}
        </SidebarContent>

        <SidebarFooter className="p-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <AccountMenu email={email} />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <RenameConversationDialog conversation={renaming} onOpenChange={(o) => !o && setRenaming(null)} />
      <DeleteConversationDialog conversation={deleting} onOpenChange={(o) => !o && setDeleting(null)} />
    </>
  );
}
