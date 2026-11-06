import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import { isRecentlyValidated, rememberValidatedUser } from "@/lib/auth-cache";

// Client-only gate: the session lives in browser storage, which SSR cannot read.
export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const sessionUser = sessionData.session?.user;
    if (sessionUser && isRecentlyValidated(sessionUser.id)) {
      return { user: sessionUser };
    }
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
    rememberValidatedUser(data.user.id);
    return { user: data.user };
  },
  component: () => <Outlet />,
});
