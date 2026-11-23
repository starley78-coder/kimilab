# Kimi Lab — roadmap

## Done
- [x] Database: conversations, messages, request log + rate-limit function, owner access, private image storage
- [x] Server chat endpoint: auth check, rate limit, Kimi streaming (SSE) + non-stream fallback, error mapping, usage capture
- [x] Connection check (model list probe) + config status
- [x] Auth: email/password, Google, Lovable sign-in, reset password
- [x] Chat UI: sidebar (new/rename/delete/search), thread pages, markdown/code/tables, copy, stop, generation phases
- [x] Composer: Enter/Shift+Enter, clear, image attach + preview (PNG/JPG/WebP)
- [x] Settings panel: model, reasoning effort (Low/High/Max, default High), theme light/dark/system
- [x] Token usage per message + conversation totals
- [x] Tests for rules (provider config, error mapping, SSE parsing, effort default, image rules)
- [x] End-to-end verification with the real provider (text, stop, image, reload, limits, key not exposed)

## Open (needs the owner)
- [ ] Sign in with a real account (password / Google) — could not be exercised with a password-less test account

## Ready (later)
- Export a conversation to Markdown
- Regenerate the last answer
- Edit and resend the last question
- `Retry-After` countdown on the limit card with automatic resend
- Paste / drag-and-drop images straight into the message field
- Pin and archive conversations
