import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Loader2, MailCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { safeRedirectPath } from "@/lib/safe-redirect";

const searchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "Вход — Kimi Lab" },
      { name: "description", content: "Войдите в своё личное пространство Kimi Lab." },
      { property: "og:title", content: "Вход — Kimi Lab" },
      { property: "og:description", content: "Войдите в своё личное пространство Kimi Lab." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup" | "forgot";

function AuthPage() {
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<{ email: string; kind: "confirm" | "reset" } | null>(null);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSignedInAs(data.session?.user.email ?? null);
    });
  }, []);

  const goNext = () => {
    navigate({ href: safeRedirectPath(redirect), replace: true });
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          toast.error(
            error.message.includes("Invalid login")
              ? "Неверный email или пароль"
              : error.message.includes("Email not confirmed")
                ? "Email ещё не подтверждён — проверьте почту"
                : error.message,
          );
          return;
        }
        goNext();
      } else if (mode === "signup") {
        if (password.length < 8) {
          toast.error("Пароль должен быть не короче 8 символов");
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth` },
        });
        if (error) {
          toast.error(error.message);
          return;
        }
        if (data.session) {
          goNext();
          return;
        }
        setSentTo({ email, kind: "confirm" });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) {
          toast.error(error.message);
          return;
        }
        setSentTo({ email, kind: "reset" });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark className="size-12" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">Kimi Lab</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Персональное пространство для работы с Kimi K3.1 Pro
          </p>
        </div>

        {signedInAs ? (
          <div className="rounded-2xl border bg-card p-6 text-center shadow-composer">
            <p className="text-sm text-muted-foreground">Вы уже вошли как</p>
            <p className="mt-1 truncate font-medium">{signedInAs}</p>
            <Button className="mt-5 w-full" size="xl" onClick={goNext}>
              Открыть диалоги <ArrowRight />
            </Button>
            <button
              type="button"
              className="mt-3 text-xs text-muted-foreground underline-offset-4 hover:underline"
              onClick={async () => {
                await supabase.auth.signOut();
                setSignedInAs(null);
              }}
            >
              Выйти и войти другим аккаунтом
            </button>
          </div>
        ) : sentTo ? (
          <div className="rounded-2xl border bg-card p-6 text-center shadow-composer">
            <MailCheck className="mx-auto size-8 text-signal" />
            <h2 className="mt-3 font-medium">Проверьте почту</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {sentTo.kind === "confirm"
                ? "Мы отправили ссылку для подтверждения на "
                : "Мы отправили ссылку для сброса пароля на "}
              <span className="font-medium text-foreground">{sentTo.email}</span>.
            </p>
            <Button
              variant="outline"
              className="mt-5 w-full"
              onClick={() => {
                setSentTo(null);
                setMode("signin");
              }}
            >
              Вернуться ко входу
            </Button>
          </div>
        ) : (
          <div className="rounded-2xl border bg-card p-6 shadow-composer">
            {mode !== "forgot" ? (
              <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="mb-5">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="signin">Вход</TabsTrigger>
                  <TabsTrigger value="signup">Регистрация</TabsTrigger>
                </TabsList>
              </Tabs>
            ) : (
              <div className="mb-5">
                <h2 className="font-medium">Сброс пароля</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Пришлём ссылку для установки нового пароля.
                </p>
              </div>
            )}

            <form onSubmit={onSubmit} className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="h-10"
                />
              </div>
              {mode !== "forgot" && (
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Пароль</Label>
                    {mode === "signin" && (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                        onClick={() => setMode("forgot")}
                      >
                        Забыли пароль?
                      </button>
                    )}
                  </div>
                  <Input
                    id="password"
                    type="password"
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    required
                    minLength={mode === "signup" ? 8 : undefined}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-10"
                  />
                </div>
              )}
              <Button type="submit" size="xl" className="w-full" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                {mode === "signin" ? "Войти" : mode === "signup" ? "Создать аккаунт" : "Отправить ссылку"}
              </Button>
              {mode === "forgot" && (
                <button
                  type="button"
                  className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  onClick={() => setMode("signin")}
                >
                  Назад ко входу
                </button>
              )}
            </form>

            {mode !== "forgot" && (
              <>
                <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  или
                  <span className="h-px flex-1 bg-border" />
                </div>
                <OAuthButtons onSignedIn={goNext} />
              </>
            )}
          </div>
        )}

        <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
          Личное пространство: доступ к модели получает только владелец — первый вошедший аккаунт.
        </p>
      </div>
    </main>
  );
}
