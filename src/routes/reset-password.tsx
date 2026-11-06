import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Новый пароль — Kimi Lab" },
      { name: "description", content: "Установите новый пароль для входа в Kimi Lab." },
      { property: "og:title", content: "Новый пароль — Kimi Lab" },
      { property: "og:description", content: "Установите новый пароль для входа в Kimi Lab." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    const isRecovery = window.location.hash.includes("type=recovery");
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    supabase.auth.getSession().then(({ data: s }) => {
      setReady((prev) => prev ?? (isRecovery || !!s.session));
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Пароль должен быть не короче 8 символов");
      return;
    }
    if (password !== confirm) {
      toast.error("Пароли не совпадают");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Пароль обновлён");
    navigate({ to: "/chat", replace: true });
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark className="size-12" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">Новый пароль</h1>
        </div>
        <div className="rounded-2xl border bg-card p-6 shadow-composer">
          {ready === false ? (
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                Ссылка недействительна или устарела. Запросите новую на странице входа.
              </p>
              <Button className="mt-5 w-full" variant="outline" onClick={() => navigate({ to: "/auth" })}>
                На страницу входа
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="new-password">Новый пароль</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-10"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="confirm-password">Повторите пароль</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="h-10"
                />
              </div>
              <Button type="submit" size="xl" className="w-full" disabled={busy || ready === null}>
                {busy && <Loader2 className="animate-spin" />}
                Сохранить пароль
              </Button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
