import { createFileRoute, redirect } from "@tanstack/react-router";

// The app's home is the chat workspace; signed-out visitors are sent to sign-in by the gate.
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Kimi Lab — персональный интерфейс для Kimi K3.1 Pro" },
      {
        name: "description",
        content: "Личное рабочее пространство для диалогов с моделью Kimi K3.1 Pro.",
      },
      { property: "og:title", content: "Kimi Lab — персональный интерфейс для Kimi K3.1 Pro" },
      {
        property: "og:description",
        content: "Личное рабочее пространство для диалогов с моделью Kimi K3.1 Pro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/chat" });
  },
});
