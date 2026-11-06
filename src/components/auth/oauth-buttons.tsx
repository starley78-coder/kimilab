import "@lovable.dev/cloud-auth-js/styles.css";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { lovable } from "@/integrations/lovable/index";

function GoogleLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px]">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
      />
    </svg>
  );
}

export function OAuthButtons({ onSignedIn }: { onSignedIn: () => void }) {
  const [pending, setPending] = useState<"google" | "lovable" | null>(null);

  const signIn = async (provider: "google" | "lovable") => {
    setPending(provider);
    try {
      const result = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: window.location.origin + "/auth",
      });
      if (result.error) {
        toast.error("Не удалось войти", { description: result.error.message });
        return;
      }
      if (result.redirected) return;
      onSignedIn();
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="grid gap-2.5">
      <Button
        type="button"
        variant="outline"
        disabled={pending !== null}
        onClick={() => signIn("google")}
        className="h-10 gap-2.5 rounded-lg border-google-border bg-google px-3 text-sm font-medium text-google-foreground hover:bg-google hover:text-google-foreground hover:opacity-90"
      >
        <GoogleLogo />
        Продолжить с Google
      </Button>
      <button
        type="button"
        className="lovable-auth-button"
        disabled={pending !== null}
        onClick={() => signIn("lovable")}
      >
        Продолжить с Lovable
      </button>
    </div>
  );
}
