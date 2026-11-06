# Kimi Lab — roadmap

## In progress
- [ ] Database: conversations, messages, request log + rate-limit function, owner access, image storage bucket
- [ ] Server chat endpoint: auth check, rate limit, Kimi streaming (SSE) + non-stream fallback, error mapping, usage capture
- [ ] Connection check (model list probe) + config status
- [ ] Auth: email/password, Google, Lovable sign-in, reset password
- [ ] Chat UI: sidebar (new/rename/delete/search), thread routes, markdown/code/tables, copy, stop, generation phases
- [ ] Composer: Enter/Shift+Enter, clear, image attach + preview (PNG/JPG/WebP)
- [ ] Settings panel: model, reasoning effort (Low/High/Max, default High), theme light/dark
- [ ] Token usage per message + conversation totals
- [ ] Tests for rules (error mapping, provider config, SSE parsing, effort default)
- [ ] End-to-end verification; request KIMI secrets

## Ready (later)
- Export a conversation to Markdown
- Regenerate last answer
