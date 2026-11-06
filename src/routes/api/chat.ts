import { createFileRoute } from "@tanstack/react-router";

// Streaming chat endpoint. Auth, access, rate limiting and the Kimi call all happen
// server-side in the handler; the browser never sees the API key.
export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleChatRequest } = await import("@/lib/chat-stream.server");
        return handleChatRequest(request);
      },
    },
  },
});
