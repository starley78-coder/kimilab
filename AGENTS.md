<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Kimi Lab architecture rules

- **Server boundary.** Every Kimi request goes through the server route `src/routes/api/chat.ts` (logic in `src/lib/chat-stream.server.ts`) or a server function in `src/lib/kimi.functions.ts`; browser code never calls the provider. Why: the API key must exist only in server secrets. (TanStack server routes are this stack's replacement for Supabase Edge Functions.)
- **Provider config.** Base URL, model ID and key are resolved only in `src/lib/kimi/config.ts` from `KIMI_API_KEY`, `KIMI_API_BASE_URL`, `KIMI_MODEL_ID`, and request bodies are built only in `src/lib/kimi/request.ts`. Never add a fallback to another model. Why: the owner wants the real model or the real error.
- **Reasoning stays on the server.** `reasoning_content` is dropped while parsing the provider stream (`src/lib/kimi/sse.ts`); it is never sent to the browser or stored. Why: only the final answer may be shown.
- **Errors.** Provider failures are mapped and scrubbed in `src/lib/kimi/errors.ts` before leaving the server. Why: no key or account identifier may reach the browser.
- **Idempotent turns.** The browser generates the user and assistant message IDs; the server and browser write messages with upsert-ignore on those IDs. Why: retries and Stop must not duplicate rows.
- **Stop.** The browser aborts its request and stores a `stopped` assistant row under the agreed ID; the server polls for that row and aborts the provider call. Why: the runtime does not reliably report a closed connection.
- **Images.** Files live in the private `chat-images` bucket under `<userId>/<conversationId>/`; message rows keep only attachment metadata. Why: no base64 in the database.
- **Access.** One owner per workspace via `public.user_roles` and `claim_workspace_access()`; other accounts get no data. Why: personal app.
- **Rate limit.** `consume_chat_quota()` runs on the server before each provider request. Why: atomic and not bypassable from the browser.
- **Chat UI.** Compose the thread, messages and composer from `src/components/ai-elements`; app-specific pieces live in `src/components/chat`. Why: one consistent chat surface.
- **Rules are tested** in `src/test/kimi-rules.test.ts`; extend it when a provider, error or effort rule changes.
- **System instructions.** A conversation's `system_prompt` wins; `null` falls back to `user_settings.default_system_prompt`; empty string means none (`resolveSystemPrompt`). Resolved on the server only. Why: one predictable precedence.
- **Text files** are inlined into message content as `<file name="…">` blocks (`src/lib/chat/text-files.ts`), not stored in the bucket. Why: the model reads them as text and history replays them.
- **Context meter** uses only API usage of the last reply; a percentage appears only when `KIMI_CONTEXT_WINDOW` is set. Why: no invented limits.
- **Backups** (`src/lib/chat/export.ts`) are versioned JSON without image files; import always creates new conversations. Why: never overwrite existing data.
- **Account API** (balance, token estimate) lives in `src/lib/kimi/balance.ts` and is called only for the official Moonshot base URL. Why: other gateways do not document it.
- **Summaries** use Lovable AI Gateway (`src/lib/summary/*`), never the Kimi provider, and are stored in `conversation_summaries`. Why: separate billing and model choice from the chat.
- **Instruction presets** live in `src/lib/chat/presets.ts`; picking one only fills the field. Why: nothing is saved without the owner pressing Save.
- **Analytics** use `window.__lovableEvents?.track?.` at call sites with schemas in `.lovable/events.json`. Why: one queryable pipeline.
- **Agent tools.** Tools live in `src/lib/tools` (types, registry, bounded loop, search adapter, SSRF-guarded `open_url`); the chat server registers them only when the request has `search_enabled: true`. Sources shown in the UI come only from real tool results and are stored on the assistant message (`sources`, `tool_runs`). Why: no invented links, and new tools (e.g. agent_task) plug into the same registry.
- **Search provider** is picked by server secrets `SEARCH_PROVIDER` (tavily | brave) and `SEARCH_API_KEY`; missing key → "Поиск не настроен", never a fake result. Why: provider-independent chat and honest failures.
