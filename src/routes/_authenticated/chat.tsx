import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  Outlet,
  createFileRoute,
  useNavigate,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { Lock, LogOut } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { AppSidebar } from "@/components/chat/app-sidebar";
import { ChatRuntimeProvider } from "@/components/chat/chat-runtime";
import { SettingsProvider } from "@/components/chat/settings-context";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { accessQuery, conversationsQuery } from "@/lib/chat/data";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({
    meta: [
      { title: "Диалоги — Kimi Lab" },
      { name: "description", content: "Ваши диалоги с Kimi K3.1 Pro." },
      { property: "og:title", content: "Диалоги — Kimi Lab" },
      { property: "og:description", content: "Ваши диалоги с Kimi K3.1 Pro." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(accessQuery());
    void context.queryClient.prefetchQuery(conversationsQuery());
  },
  pendingComponent: ChatPending,
  errorComponent: ChatError,
  component: ChatLayout,
});

function ChatPending() {
  return (
    <div className="flex h-dvh">
      <div className="hidden w-64 flex-col gap-3 border-r bg-sidebar p-3 md:flex">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <div className="mt-4 grid gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center">
        <BrandMark className="size-10 animate-pulse" />
      </div>
    </div>
  );
}

function ChatError({ error, reset }: ErrorComponentProps) {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="max-w-sm text-center">
        <BrandMark className="mx-auto size-10" />
        <h1 className="mt-4 text-lg font-semibold">Не удалось открыть Kimi Lab</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {error instanceof Error ? error.message : String(error)}
        </p>
        <Button className="mt-5" onClick={reset}>
          Повторить
        </Button>
      </div>
    </div>
  );
}

function NoAccess({ email }: { email: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-composer">
        <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-muted">
          <Lock className="size-4 text-muted-foreground" />
        </span>
        <h1 className="mt-4 text-lg font-semibold">Это персональное пространство</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Аккаунт <span className="font-medium text-foreground">{email}</span> не является
          владельцем Kimi Lab, поэтому доступ к модели и истории закрыт.
        </p>
        <Button
          variant="outline"
          className="mt-5 w-full"
          onClick={async () => {
            await queryClient.cancelQueries();
            queryClient.clear();
            await supabase.auth.signOut();
            void navigate({ to: "/auth", replace: true });
          }}
        >
          <LogOut /> Выйти
        </Button>
      </div>
    </div>
  );
}

function ChatLayout() {
  const { user } = Route.useRouteContext();
  const { data: access } = useSuspenseQuery(accessQuery());
  const email = user.email ?? "аккаунт";

  if (!access.has_access) return <NoAccess email={email} />;

  return (
    <ChatRuntimeProvider userId={user.id}>
      <SettingsProvider>
        <SidebarProvider>
          <AppSidebar email={email} />
          <SidebarInset className="flex h-dvh min-h-0 flex-col overflow-hidden">
            <Outlet />
          </SidebarInset>
        </SidebarProvider>
      </SettingsProvider>
    </ChatRuntimeProvider>
  );
}
